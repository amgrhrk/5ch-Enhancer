function insertAfter(referenceNode: Node, newNode: Node) {
	const parentNode = referenceNode.parentNode!
	parentNode.insertBefore(newNode, referenceNode.nextSibling)
}

namespace Twitter {
	let isLoaded = false

	export async function init() {
		if (isLoaded) {
			return Promise.resolve()
		}
		return new Promise<void>((resolve, reject) => {
			const script = GM_addElement('script', { src: GM_getResourceURL('twitter') })
			script.addEventListener('load', () => {
				isLoaded = true
				resolve()
			})
			script.addEventListener('error', reject)
		})
	}

	export async function load(container: HTMLElement) {
		if (!isLoaded) {
			await init()
		}
		twttr.widgets.load(container)
	}

	export async function create(url: string) {
		const response = await GM_fetch(`https://publish.twitter.com/oembed?url=${url}&omit_script=true`)
		const div = document.createElement('div')
		div.innerHTML = (await response.json()).html
		return div
	}

	export function trim(url: string) {
		if (!url.includes('twimg')) {
			return url
		}
		if (url.endsWith('orig')) {
			return url
		}
		if (url.endsWith('&')) {
			return `${url}name=orig`
		}
		const suffixes = ['large', 'medium', 'small', '900x900', 'thumb']
		const suffix = suffixes.find(suffix => url.endsWith(suffix))
		if (suffix) {
			return `${url.substring(0, url.length - suffix.length)}orig`
		}
		return url
	}
}

namespace Images {
	type Message = {
		id: number
		format: 'jpg' | 'png'
		image: ArrayBuffer
		hash?: string
		error?: unknown
	}

	export class Hash {
		private globalId: number
		private resolves: Map<number, (value: string | PromiseLike<string>) => void>
		private rejects: Map<number, (reason?: any) => void>
		private worker: Worker

		constructor(scriptURL: string | URL, options?: WorkerOptions) {
			this.globalId = 0
			this.resolves = new Map()
			this.rejects = new Map()
			this.worker = new Worker(scriptURL, options)
			this.worker.onmessage = (e: MessageEvent<Message>) => {
				if (e.data.error) {
					this.rejects.get(e.data.id)!(e.data.error)
				} else {
					this.resolves.get(e.data.id)!(e.data.hash!)
				}
				this.resolves.delete(e.data.id)
				this.rejects.delete(e.data.id)
			}
		}

		async get(image: ArrayBuffer, format: 'jpg' | 'png') {
			const message: Message = {
				id: this.globalId,
				format: format,
				image: image
			}
			this.globalId++
			return new Promise<string>((resolve, reject) => {
				this.resolves.set(message.id, resolve)
				this.rejects.set(message.id, reject)
				this.worker.postMessage(message)
			})
		}
	}

	export function create(src: string, post: Post, config: Config, modal: Modal, hash: Hash) {
		const formatMatch = src.match(/jpg|jpeg|gif|png|bmp|webp/)
		if (!formatMatch) {
			return null
		}
		const fragment = document.createDocumentFragment()
		const image = document.createElement('img') as typeof post.images[number]
		image.src = src
		image.loading = 'lazy'
		image.format = formatMatch[0]
		image.classList.add('vch-enhancer-post-img')
		modal.add(image)
		if (!config.blockImages || (image.format !== 'jpg' && image.format !== 'png')
			|| !src.match(/imgur|twimg/)) {
			fragment.appendChild(document.createElement('br'))
			fragment.appendChild(image)
			return fragment
		}
		const blockButton = document.createElement('a')
		blockButton.innerText = 'ブロック'
		blockButton.href = 'javascript:void(0)'
		blockButton.addEventListener('click', async () => {
			post.hide()
			try {
				const response = await GM_fetch(src)
				const arraybuffer = await response.arrayBuffer()
				const _hash = await hash.get(arraybuffer, image.format as 'jpg' | 'png')
				config.blockedImages.add(_hash)
				config.save()
			} catch (err) {
				log(err)
			}
		})
		fragment.appendChild(document.createTextNode('\xa0\xa0'))
		fragment.appendChild(blockButton)
		fragment.appendChild(document.createElement('br'))
		fragment.appendChild(image)
		if (config.blockedImages.size === 0) {
			return fragment
		}
		image.addEventListener('load', async () => {
			if (post.isHidden) { return }
			try {
				const response = await GM_fetch(image.src)
				if (post.isHidden) { return }
				const arraybuffer = await response.arrayBuffer()
				if (post.isHidden) { return }
				const _hash = await hash.get(arraybuffer, image.format as 'jpg' | 'png')
				if (!post.isHidden && config.blockedImages.has(_hash)) {
					post.hide()
				}
			} catch (err) {
				log(err)
			}
		})
		return fragment
	}
}

class VirtualDiv {
	children: HTMLElement[]
	classList: {
		add(...tokens: string[]): void
		remove(...tokens: string[]): void
	}

	constructor(...elements: HTMLElement[]) {
		this.children = elements
		this.classList = {
			add: VirtualDiv.add.bind(this),
			remove: VirtualDiv.remove.bind(this)
		}
	}

	private static add(this: VirtualDiv, ...tokens: string[]) {
		for (const child of this.children) {
			child.classList.add(...tokens)
		}
	}

	private static remove(this: VirtualDiv, ...tokens: string[]) {
		for (const child of this.children) {
			child.classList.remove(...tokens)
		}
	}

	get firstElementChild() {
		if (this.children.length === 0) {
			return null
		}
		return this.children[0] as Element
	}

	get lastElementChild() {
		if (this.children.length === 0) {
			return null
		}
		return this.children[this.children.length - 1] as Element
	}
}

abstract class Post {
	container!: HTMLElement | VirtualDiv
	images: (HTMLImageElement & { format: string })[]
	isHidden: boolean
	abstract get name(): string
	abstract get isp(): string
	abstract get id(): string
	abstract get content(): string
	abstract get urls(): HTMLAnchorElement[]
	abstract nameOrIspIncludes(keyword: string): boolean

	constructor() {
		this.images = []
		this.isHidden = false
	}

	show() {
		this.container.classList.remove('vch-enhancer-hide')
		this.isHidden = false
	}

	hide() {
		this.container.classList.add('vch-enhancer-hide')
		this.isHidden = true
	}

	static getMostFrequentName(posts: Post[]) {
		const nameToCount = new Map<string, number>()
		let mostFrequentName = ''
		for (const post of posts) {
			const name = post.name
			nameToCount.set(name, (nameToCount.get(name) || 0) + 1)
			if (nameToCount.get(name)! > (nameToCount.get(mostFrequentName) || 0)) {
				mostFrequentName = name
			}
		}
		return mostFrequentName
	}

	nameOrIspIncludesAnyOf(keywords: Iterable<string>) {
		for (const keyword of keywords) {
			if (this.nameOrIspIncludes(keyword)) {
				return true
			}
		}
		return false
	}

	contentIncludesAnyOf(keywords: Iterable<string>) {
		for (const keyword of keywords) {
			if (this.content.includes(keyword)) {
				return true
			}
		}
		return false
	}
}

class NewPost extends Post {
	constructor(container: HTMLElement) {
		super()
		this.container = container
	}

	get name(): string {
		throw new Error('Not Implemented')
	}

	get isp(): string {
		throw new Error('Not Implemented')
	}

	get id() {
		const meta = this.container.firstElementChild!
		const uid = meta.children[3] as HTMLElement
		return uid.innerText
	}

	get content() {
		const container = this.container.lastElementChild!
		const innerContainer = container.firstElementChild as HTMLElement
		return innerContainer.innerText
	}

	get urls() {
		const container = this.container.lastElementChild!
		const innerContainer = container.firstElementChild!
		return [...innerContainer.querySelectorAll('a')]
	}

	nameOrIspIncludes(string: string) {
		const meta = this.container.firstElementChild!
		const nameAndIsp = meta.children[1] as HTMLElement
		return nameAndIsp.innerText.includes(string)
	}
}

class OldPost extends Post {
	constructor(...elements: HTMLElement[]) {
		super()
		this.container = new VirtualDiv(...elements)
	}

	get name(): string {
		throw new Error('Not Implemented')
	}

	get isp(): string {
		throw new Error('Not Implemented')
	}

	get id(): string {
		throw new Error('Not Implemented')
	}

	get content() {
		return (this.container.children[1] as HTMLElement).innerText
	}

	get urls() {
		return [...this.container.children[1].querySelectorAll('a')]
	}

	nameOrIspIncludes(string: string) {
		const meta = this.container.firstElementChild!
		const nameAndIsp = meta.children[0] as HTMLElement
		return nameAndIsp.innerText.includes(string)
	}
}

type GMConfig = {
	embedThumbnails?: boolean
	embedTweets?: boolean
	blockUsers?: boolean
	blockWords?: boolean
	blockImages?: boolean
	blockedUsers?: string[]
	blockedWords?: string[]
	blockedImages?: string[]
	suspiciousNames?: string[]
}

class Config {
	embedThumbnails!: boolean
	embedTweets!: boolean
	blockUsers!: boolean
	blockWords!: boolean
	blockImages!: boolean
	blockedUsers!: Set<string>
	blockedWords!: Set<string>
	blockedImages!: Set<string>
	suspiciousNames!: Set<string>
	private static booleanFields = ['embedThumbnails', 'embedTweets', 'blockUsers', 'blockWords', 'blockImages'] as const
	private static setFields = ['blockedUsers', 'blockedWords', 'blockedImages', 'suspiciousNames'] as const

	constructor() {
		const config = (GM_getValue(scriptName) || {}) as GMConfig
		for (const field of Config.booleanFields) {
			this[field] = config[field] === false ? false : true
		}
		for (const field of Config.setFields) {
			this[field] = config[field] ? new Set(config[field]) : new Set()
		}
	}

	save() {
		const config = {} as GMConfig
		for (const field of Config.booleanFields) {
			config[field] = this[field]
		}
		for (const field of Config.setFields) {
			config[field] = [...this[field]]
		}
		GM_setValue(scriptName, config)
	}
}

function embedThumbnails(post: Post, urls: HTMLAnchorElement[], config: Config, modal: Modal, hash: Images.Hash) {
	if (post.nameOrIspIncludesAnyOf(config.suspiciousNames)) {
		return
	}
	for (const url of urls) {
		const fragment = Images.create(url.href, post, config, modal, hash)
		if (fragment) {
			post.images.push(fragment.lastElementChild as typeof post.images[number])
			insertAfter(url, fragment)
		}
	}
}

function embedTweets(urls: HTMLAnchorElement[]) {
	// Intended to not wait
	urls.filter(url => url.href.match(/twitter\.com\/.+?\/status\/./)).forEach(async url => {
		try {
			const tweet = await Twitter.create(url.href)
			if (url.nextElementSibling?.tagName === 'BR') {
				url.nextElementSibling.remove()
			}
			insertAfter(url, tweet)
			Twitter.load(tweet)
		} catch (err) {
			log(err)
		}
	})
}

abstract class MenuItem {
	container: HTMLDivElement
	checkbox?: HTMLInputElement & {
		key: keyof GMConfig
		disables?: { disabled: boolean }[]
	}
	button?: HTMLButtonElement
	textArea?: HTMLTextAreaElement & {
		key: keyof GMConfig
	}

	constructor() {
		this.container = document.createElement('div')
		this.container.classList.add('vch-enhancer-menu-item')
	}

	static builder() {
		return new MenuItem.Builder()
	}

	private static MenuItem = class extends MenuItem {}
	static Builder = class MenuItemBuilder {
		private _text?: string
		private _checkbox?: { key: keyof GMConfig }
		private _button?: { text: string }
		private _textArea?: { key: keyof GMConfig }

		text(text: string) {
			this._text = text
			return this
		}

		checkbox(key: keyof GMConfig) {
			this._checkbox = { key }
			return this
		}

		button(text: string) {
			this._button = { text }
			return this
		}

		textArea(key: keyof GMConfig) {
			this._textArea = { key }
			return this
		}

		private createCheckbox(item: MenuItem) {
			if (!this._checkbox) {
				return null
			}
			const checkbox = document.createElement('input') as NonNullable<MenuItem['checkbox']>
			checkbox.key = this._checkbox.key
			checkbox.type = 'checkbox'
			checkbox.classList.add('option_style_6')
			item.checkbox = checkbox
			item.container.insertAdjacentElement('afterbegin', checkbox)
			return checkbox
		}

		private createButton(item: MenuItem) {
			if (!this._button) {
				return null
			}
			const button = document.createElement('button')
			button.innerText = this._button.text
			button.classList.add('option_style_13')
			item.button = button
			item.container.insertAdjacentElement('beforeend', button)
			return button
		}

		private createTextArea(item: MenuItem) {
			if (!this._textArea) {
				return null
			}
			const textArea = document.createElement('textarea') as NonNullable<MenuItem['textArea']>
			textArea.key = this._textArea.key
			textArea.classList.add('vch-enhancer-hide')
			item.textArea = textArea
			return textArea
		}

		build() {
			const item = new MenuItem.MenuItem() as MenuItem
			if (this._text != null) {
				item.container.innerText = this._text
			}
			this.createCheckbox(item)
			this.createButton(item)
			this.createTextArea(item)
			return item
		}

		static disableOthersWhenUnchecked(item: MenuItem, ...disables: { disabled: boolean }[]) {
			if (item.checkbox!.disables) {
				for (const disable of disables) {
					item.checkbox!.disables.push(disable)
				}
				return
			}
			item.checkbox!.disables = disables
			item.checkbox!.addEventListener('change', () => {
				item.checkbox!.checked
					? item.checkbox!.disables!.forEach(e => e.disabled = false)
					: item.checkbox!.disables!.forEach(e => e.disabled = true)
			})
		}
	}
}

namespace Menu {
	export function retry(config: Config, count: number) {
		if (count < 3 && !create(config)) {
			setTimeout(retry, 1000, config, count + 1)
		}
	}

	export function create(config: Config) {
		const vanillaItem = document.querySelector('.option_style_8')
		if (!vanillaItem) {
			return false
		}

		const items = [
			MenuItem.builder().checkbox('embedThumbnails')
				.text('サムネイル画像を表示する').build(),
			MenuItem.builder().checkbox('embedTweets')
				.text('ツイートを埋め込む').build(),
			MenuItem.builder().checkbox('blockUsers')
				.text('NGユーザー').button('設定').textArea('blockedUsers').build(),
			MenuItem.builder().checkbox('blockWords')
				.text('NGワード').button('設定').textArea('blockedWords').build(),
			MenuItem.builder().checkbox('blockImages')
				.text('NG画像').button('設定').textArea('blockedImages').build()
		]
		MenuItem.Builder.disableOthersWhenUnchecked(items[0], items[4].checkbox!, items[4].button!)
		MenuItem.Builder.disableOthersWhenUnchecked(items[2], items[2].button!)
		MenuItem.Builder.disableOthersWhenUnchecked(items[3], items[3].button!)
		MenuItem.Builder.disableOthersWhenUnchecked(items[4], items[4].button!)
		items.forEach(item => item.checkbox!.checked = config[item.checkbox!.key] as boolean)

		const popup = new Popup()
		popup.current = items[2].textArea!
		const itemsWithTextArea = [items[2], items[3], items[4]]
		for (const item of itemsWithTextArea) {
			item.textArea!.value = [...config[item.textArea!.key] as Set<string>].join('\n')
			popup.window.appendChild(item.textArea!)
			item.button!.addEventListener('click', () => {
				popup.show(item)
			})
		}
		const confirmButton = document.getElementById('saveOptions')
		confirmButton?.addEventListener('click', () => {
			for (const item of itemsWithTextArea) {
				const values = new Set(item.textArea!.value.split('\n'))
				values.delete('')
				;(config[item.textArea!.key] as Set<string>) = values
			}
			config.save()
		})
		const cancelButtons = [
			document.getElementById('cancelOptions'),
			document.getElementById('close_options'),
			document.getElementById('option_container_bg')
		]
		for (const button of cancelButtons) {
			button?.addEventListener('click', () => {
				for (const item of itemsWithTextArea) {
					item.textArea!.value = [...config[item.textArea!.key] as Set<string>].join('\n')
				}
			})
		}

		const fragment = document.createDocumentFragment()
		items.forEach(item => fragment.appendChild(item.container))
		insertAfter(vanillaItem, fragment)
		return true
	}

	class Popup {
		background: HTMLDivElement
		window: HTMLDivElement
		current!: HTMLTextAreaElement

		constructor() {
			this.background = document.createElement('div')
			this.background.classList.add('vch-enhancer-popup-background', 'vch-enhancer-hide')
			this.background.addEventListener('mouseup', (e) => e.stopPropagation())
			this.background.addEventListener('click', (e) => {
				e.stopPropagation()
				if (e.target !== e.currentTarget) {
					return
				}
				this.hide()
			})
			this.window = document.createElement('div')
			this.window.classList.add('vch-enhancer-popup-window')
			this.background.appendChild(this.window)
			document.body.appendChild(this.background)
		}

		show(menuItem: MenuItem) {
			menuItem.textArea!.classList.remove('vch-enhancer-hide')
			this.background.classList.remove('vch-enhancer-hide')
			this.current = menuItem.textArea!
		}

		hide() {
			this.background.classList.add('vch-enhancer-hide')
			this.current.classList.add('vch-enhancer-hide')
		}
	}
}