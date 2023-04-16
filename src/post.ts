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
}

abstract class Post {
	container!: VirtualDiv
	isHidden: boolean
	forceHidden: boolean
	abstract get name(): string
	abstract get isp(): string
	abstract get id(): string
	abstract get content(): string
	abstract get contentAsNodes(): Node[]
	abstract get urls(): HTMLAnchorElement[]
	abstract nameOrIspIncludes(keyword: string): boolean

	constructor() {
		this.isHidden = false
		this.forceHidden = false
	}

	show() {
		if (this.forceHidden) {
			return
		}
		this.container.classList.remove('vch-enhancer-hide')
		this.isHidden = false
	}

	hide(force?: boolean) {
		this.container.classList.add('vch-enhancer-hide')
		this.isHidden = true
		if (force) {
			this.forceHidden = true
		}
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

	convertTextToUrl() {
		for (const node of this.contentAsNodes) {
			if (node.nodeType !== Node.TEXT_NODE || !node.textContent) {
				continue
			}
			const match = node.textContent.match(/^ (?:tp|ttp|tps|ttps|ps):\/\//)
			if (!match) {
				continue
			}
			const url = document.createElement('a')
			url.href = `https://${node.textContent.substring(match[0].length).trimEnd()}`
			url.innerText = url.href
			url.target = '_blank'
			url.rel = 'noopener noreferrer'
			insertAfter(node, url)
			node.parentNode!.removeChild(node)
		}
	}
}

class NewPost extends Post {
	constructor(...elements: HTMLElement[]) {
		super()
		this.container = new VirtualDiv(...elements)
	}

	private get meta() {
		return this.container.children[0].children[0]
	}

	private get contentContainer() {
		const container = this.container.children[0].lastElementChild!
		return container.children[0] as HTMLElement
	}

	get name(): string {
		throw new Error('Not Implemented')
	}

	get isp(): string {
		throw new Error('Not Implemented')
	}

	get id() {
		const uid = this.meta.children[3] as HTMLElement
		return uid.innerText
	}

	get content() {
		return this.contentContainer.innerText
	}

	get contentAsNodes() {
		return [...this.contentContainer.childNodes]
	}

	get urls() {
		return [...this.contentContainer.querySelectorAll('a')]
	}

	nameOrIspIncludes(string: string) {
		const nameAndIsp = this.meta.children[1] as HTMLElement
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

	get contentAsNodes() {
		return [...(this.container.children[1] as HTMLElement).childNodes]
	}

	get urls() {
		return [...this.container.children[1].querySelectorAll('a')]
	}

	nameOrIspIncludes(string: string) {
		const meta = this.container.children[0]
		const nameAndIsp = meta.children[0] as HTMLElement
		return nameAndIsp.innerText.includes(string)
	}
}