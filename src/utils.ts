type With<T, K extends keyof T> = T & { [P in K]-?: NonNullable<T[P]> }

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
		const suffixes = ['large', 'medium', 'small', '900x900', 'thumb'] as const
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
				this.worker.postMessage(message, [message.image])
			})
		}
	}

	function createMediaElement(src: string, format: string, modal: Modal) {
		switch (format) {
			case 'mp4':
				const video = document.createElement('video')
				video.src = src
				video.controls = true
				video.classList.add('vch-enhancer-post-img')
				return video
			default:
				const image = document.createElement('img') as HTMLImageElement
				image.src = src
				image.loading = 'lazy'
				image.classList.add('vch-enhancer-post-img')
				modal.add(image)
				return image
		}
	}

	function isHashable(media: HTMLVideoElement | HTMLImageElement, format: string) {
		return (format === 'jpg' || format === 'png') && media.src.match(/imgur|twimg/) as unknown as boolean
	}

	export function create(src: string, post: Post, config: Config, modal: Modal, hash: Hash) {
		const formatMatch = src.match(/jpg|jpeg|gif|png|webp|mp4/)
		if (!formatMatch) {
			return null
		}
		const format = formatMatch[0]
		const fragment = document.createDocumentFragment()
		const media = createMediaElement(src, format, modal)
		if (!config.blockImages || !isHashable(media, format)) {
			fragment.appendChild(document.createElement('br'))
			fragment.appendChild(media)
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
				const _hash = await hash.get(arraybuffer, format as Message['format'])
				config.blockedImages.add(_hash)
				config.save()
			} catch (err) {
				log(err)
			}
		})
		fragment.appendChild(document.createTextNode('\xa0\xa0'))
		fragment.appendChild(blockButton)
		fragment.appendChild(document.createElement('br'))
		fragment.appendChild(media)
		if (config.blockedImages.size === 0) {
			return fragment
		}
		media.addEventListener('load', async () => {
			if (post.isHidden) { return }
			try {
				const response = await GM_fetch(media.src)
				if (post.isHidden) { return }
				const arraybuffer = await response.arrayBuffer()
				if (post.isHidden) { return }
				const _hash = await hash.get(arraybuffer, format as Message['format'])
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

function embedThumbnails(post: Post, config: Config, modal: Modal, hash: Images.Hash) {
	if (post.nameOrIspIncludesAnyOf(config.suspiciousNames)) {
		return
	}
	for (const url of post.urls) {
		const fragment = Images.create(url.href, post, config, modal, hash)
		if (fragment) {
			insertAfter(url, fragment)
		}
	}
}

function embedTweets(post: Post) {
	// Intended to not wait
	post.urls.filter(url => url.href.match(/twitter\.com\/.+?\/status\/./))
		.forEach(async url => {
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

function enableLazyLoading(posts: Post[], index = 100, target = document.createElement('div')) {
	if (index > 100) {
		for (let i = index - 100; i < index && i < posts.length; i++) {
			posts[i].show()
		}
	}
	if (index >= posts.length) {
		return
	}
	for (let i = index; i < posts.length; i++) {
		posts[i].hide()
	}
	const lastPost = posts[index]
	const lastElement = lastPost.container.children[0]
	lastElement.insertAdjacentElement('beforebegin', target)
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				observer.disconnect()
				enableLazyLoading(posts, index + 100, target)
				return
			}
		}
	})
	observer.observe(target)
}