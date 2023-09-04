/**
 * K and V have to be different types.
 */
class BiMap<K, V> extends Map {
	private reverseMap: Map<V, K>

	constructor() {
		super()
		this.reverseMap = new Map()
	}

	get(keyOrValue: K | V): K | V | undefined {
		if (super.has(keyOrValue)) {
			return super.get(keyOrValue)
		}
		return this.reverseMap.get(keyOrValue as V)
	}

	getKey(value: V): K | undefined {
		return this.reverseMap.get(value)
	}

	getValue(key: K): V | undefined {
		return super.get(key)
	}

	set(key: K, value: V) {
		super.set(key, value)
		this.reverseMap.set(value, key)
		return this
	}

	has(keyOrValue: K | V) {
		return super.has(keyOrValue) || this.reverseMap.has(keyOrValue as V)
	}

	delete(keyOrValue: K | V) {
		if (super.has(keyOrValue)) {
			const value = super.get(keyOrValue) as V
			super.delete(keyOrValue)
			this.reverseMap.delete(value)
			return true
		}
		if (this.reverseMap.has(keyOrValue as V)) {
			const key = this.reverseMap.get(keyOrValue as V) as K
			super.delete(key)
			this.reverseMap.delete(keyOrValue as V)
			return true
		}
		return false
	}

	clear() {
		super.clear()
		this.reverseMap.clear()
	}
}

class Modal {
	private container: HTMLDivElement
	private current: { image: HTMLImageElement, index: number }
	private images: BiMap<number, HTMLImageElement>
	private mouse: {
		startX: number, startY: number,
		prevX: number, prevY: number,
		threshold: number, hasMoved: boolean
	}
	private extraKeyDownHandler?: (image: HTMLImageElement) => void

	constructor(extraKeyDownHandler?: (image: HTMLImageElement) => void) {
		this.container = document.createElement('div')
		this.container.classList.add('vch-enhancer-modal', 'vch-enhancer-hide')
		this.container.addEventListener('mousedown', this.mouseDownHandler)
		document.body.appendChild(this.container)
		this.current = {
			image: document.createElement('img'),
			index: -1
		}
		this.current.image.draggable = false
		this.container.appendChild(this.current.image)
		this.images = new BiMap()
		this.mouse = {
			startX: 0, startY: 0,
			prevX: 0, prevY: 0,
			threshold: 1, hasMoved: false
		}
		if (extraKeyDownHandler) {
			this.extraKeyDownHandler = extraKeyDownHandler
		}
	}

	private mouseDownHandler = (e: MouseEvent) => {
		if (e.button !== 0) {
			return
		}
		this.mouse.startX = e.screenX
		this.mouse.startY = e.screenY
		this.mouse.prevX = e.screenX
		this.mouse.prevY = e.screenY
		this.mouse.hasMoved = false
		window.addEventListener('mousemove', this.mouseMoveHandler)
		window.addEventListener('mouseup', this.mouseUpHandler, { once: true })
	}

	private mouseMoveHandler = (e: MouseEvent) => {
		if (!this.mouse.hasMoved) {
			const dx = (this.mouse.startX - e.screenX) / window.devicePixelRatio
			const dy = (this.mouse.startY - e.screenY) / window.devicePixelRatio
			if (Math.abs(dx) > this.mouse.threshold || Math.abs(dy) > this.mouse.threshold) {
				this.mouse.hasMoved = true
			}
		}
		const dx = (this.mouse.prevX - e.screenX) / window.devicePixelRatio
		const dy = (this.mouse.prevY - e.screenY) / window.devicePixelRatio
		this.container.scrollBy({
			top: dy,
			left: dx,
			behavior: 'instant'
		})
		this.mouse.prevX = e.screenX
		this.mouse.prevY = e.screenY
	}

	private mouseUpHandler = (e: MouseEvent) => {
		if (!this.mouse.hasMoved && (e.target === this.current.image || e.target === this.container)) {
			this.hide()
		}
		window.removeEventListener('mousemove', this.mouseMoveHandler)
	}

	private clickHandler = (e: MouseEvent) => {
		this.show(e.currentTarget as HTMLImageElement)
	}

	private keyDownHandler = (e: KeyboardEvent) => {
		if (e.repeat) {
			return
		}
		let nextIndex: number
		switch (e.code) {
			case 'KeyW':
			case 'KeyA':
			case 'ArrowUp':
			case 'ArrowLeft':
				nextIndex = ((this.current.index - 1) % this.images.size + this.images.size) % this.images.size
				break
			case 'KeyS':
			case 'KeyD':
			case 'ArrowDown':
			case 'ArrowRight':
				nextIndex = (this.current.index + 1) % this.images.size
				break
			default:
				return
		}
		const nextImage = this.images.getValue(this.current.index)!
		if (this.extraKeyDownHandler) {
			this.extraKeyDownHandler(nextImage)
		}
		this.current.index = nextIndex
		this.current.image.src = nextImage.src
	}

	show(): void
	show(index: number): void
	show(image: HTMLImageElement): void
	show(indexOrImage?: number | HTMLImageElement) {
		if (indexOrImage == undefined) {
			// Do nothing
		} else if (typeof indexOrImage === 'number') {
			this.current.image.src = this.images.getValue(indexOrImage)!.src
			this.current.index = indexOrImage
		} else {
			this.current.image.src = indexOrImage.src
			this.current.index = this.images.getKey(indexOrImage)!
		}
		window.addEventListener('keydown', this.keyDownHandler)
		document.body.classList.add('vch-enhancer-overflow-hidden')
		this.container.classList.remove('vch-enhancer-hide')
	}

	hide() {
		window.removeEventListener('keydown', this.keyDownHandler)
		document.body.classList.remove('vch-enhancer-overflow-hidden')
		this.container.classList.add('vch-enhancer-hide')
	}

	add(...images: HTMLImageElement[]) {
		const size = this.images.size
		for (const [index, image] of images.entries()) {
			image.addEventListener('click', this.clickHandler)
			this.images.set(index + size, image)
		}
	}
}

// export default Modal