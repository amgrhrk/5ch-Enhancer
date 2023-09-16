namespace Menu {
	const html = String.raw
	const template = html`
<div class="vch-enhancer-popup-modal vch-enhancer-hide">
	<div class="vch-enhancer-menu">
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				サムネイル画像を表示する
			</label>
		</div>
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				ツイートを埋め込む
			</label>
		</div>
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				クラシック版に切り替える
			</label>
		</div>
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				NGユーザー
			</label>
			<button class="vch-enhancer-button">設定</button>
		</div>
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				NGワード
			</label>
			<button class="vch-enhancer-button">設定</button>
		</div>
		<div class="vch-enhancer-menu-item">
			<label>
				<input type="checkbox" class="vch-enhancer-checkbox">
				NG画像
			</label>
			<button class="vch-enhancer-button">設定</button>
		</div>
		<div class="vch-enhancer-menu-buttons">
			<button class="vch-enhancer-button vch-enhancer-button-primary">OK</button>
			<button class="vch-enhancer-button">キャンセル</button>
		</div>
	</div>
</div>`

const textareaTemplate = html`
<div class="vch-enhancer-popup-modal vch-enhancer-hide">
	<div class="vch-enhancer-menu">
		<textarea class="vch-enhancer-hide"></textarea>
		<textarea class="vch-enhancer-hide"></textarea>
		<textarea class="vch-enhancer-hide"></textarea>
	</div>
</div>`

	function createElement(html: string) {
		const div = document.createElement('div')
		div.innerHTML = html.trim()
		return div.children[0] as HTMLElement
	}

	function trim(texts: string[]) {
		const set = new Set<string>()
		for (const text of texts) {
			const t = text.trim()
			if (t !== '') {
				set.add(t)
			}
		}
		return set
	}

	function fadeIn(element: HTMLElement, ms: number) {
		element.style.opacity = '0'
		element.style.transform = 'scale(0.9)'
		element.style.transition = `transform ${ms / 1000}s, opacity ${ms / 1000}s`
		setTimeout(() => {
			element.style.removeProperty('opacity')
			element.style.removeProperty('transform')
		}, 0)
		setTimeout(() => {
			element.style.removeProperty('transition')
		}, ms)
	}

	function fadeOut(element: HTMLElement, ms: number) {
		element.style.opacity = '0'
		element.style.transform = 'scale(0.9)'
		element.style.transition = `transform ${ms / 1000}s, opacity ${ms / 1000}s`
		setTimeout(() => {
			element.style.removeProperty('opacity')
			element.style.removeProperty('transform')
			element.style.removeProperty('transition')
		}, ms)
	}

	export function create(config: Config) {
		const menu = {
			self: createElement(template),
			show() {
				menu.self.classList.remove('vch-enhancer-hide')
				fadeIn(menu.self.children[0] as HTMLElement, 300)
			},
			hide() {
				setTimeout(() => menu.self.classList.add('vch-enhancer-hide'), 300)
				fadeOut(menu.self.children[0] as HTMLElement, 300)
			}
		}
		const textareaContainer = createElement(textareaTemplate)
		const menuToggleButton = document.createElement('a')
		menuToggleButton.href = 'javascript:void(0)'
		menuToggleButton.classList.add('vch-enhancer-menu-toggle-button')
		menuToggleButton.innerText = '設定'
		menuToggleButton.addEventListener('click', menu.show)

		const items = (function () {
			const items = menu.self.querySelectorAll<HTMLDivElement>('.vch-enhancer-menu-item')
			return {
				thumbnail: {
					self: items[0],
					checkbox: items[0].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!
				},
				tweet: {
					self: items[1],
					checkbox: items[1].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!
				},
				classic: {
					self: items[2],
					checkbox: items[2].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!
				},
				user: {
					self: items[3],
					checkbox: items[3].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!,
					button: items[3].children[1] as HTMLButtonElement
				},
				word: {
					self: items[4],
					checkbox: items[4].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!,
					button: items[4].children[1] as HTMLButtonElement
				},
				image: {
					self: items[5],
					checkbox: items[5].querySelector<HTMLInputElement>('.vch-enhancer-checkbox')!,
					button: items[5].children[1] as HTMLButtonElement
				}
			} as const
		})()

		const textareas = (function () {
			const result = textareaContainer.querySelectorAll('textarea')
			const areas = {
				user: result[0],
				word: result[1],
				image: result[2],
				show(textarea: 'user' | 'word' | 'image') {
					textareaContainer.classList.remove('vch-enhancer-hide')
					areas[textarea].classList.remove('vch-enhancer-hide')
				},
				hide() {
					areas.user.classList.add('vch-enhancer-hide')
					areas.word.classList.add('vch-enhancer-hide')
					areas.image.classList.add('vch-enhancer-hide')
					textareaContainer.classList.add('vch-enhancer-hide')
				}
			} as const
			return areas
		})()

		const buttons = (function () {
			const buttons = menu.self.querySelector('.vch-enhancer-menu-buttons')!
			return {
				ok: buttons.children[0] as HTMLButtonElement,
				cancel: buttons.children[1] as HTMLButtonElement
			} as const
		})()

		function load() {
			items.thumbnail.checkbox.checked = config.embedThumbnails
			items.tweet.checkbox.checked = config.embedTweets
			items.classic.checkbox.checked = config.switchToClassicUI
			items.user.checkbox.checked = config.blockUsers
			items.word.checkbox.checked = config.blockWords
			items.image.checkbox.checked = config.blockImages
			textareas.user.value = [...config.blockedUsers].join('\n')
			textareas.word.value = [...config.blockedWords].join('\n')
			textareas.image.value = [...config.blockedImages].join('\n')
		}

		function save() {
			config.embedThumbnails = items.thumbnail.checkbox.checked
			config.embedTweets = items.tweet.checkbox.checked
			config.switchToClassicUI = items.classic.checkbox.checked
			config.blockUsers = items.user.checkbox.checked
			config.blockWords = items.word.checkbox.checked
			config.blockImages = items.image.checkbox.checked
			config.blockedUsers = trim(textareas.user.value.split('\n'))
			config.blockedWords = trim(textareas.word.value.split('\n'))
			config.blockedImages = trim(textareas.image.value.split('\n'))
			config.save()
		}

		items.thumbnail.checkbox.addEventListener('change', () => {
			items.image.button.disabled = !(items.thumbnail.checkbox.checked && items.image.checkbox.checked)
			items.image.checkbox.disabled = !items.thumbnail.checkbox.checked
		})
		items.user.checkbox.addEventListener('change', () => {
			items.user.button.disabled = !items.user.checkbox.checked
		})
		items.user.button.addEventListener('click', () => {
			textareas.show('user')
		})
		items.word.checkbox.addEventListener('change', () => {
			items.word.button.disabled = !items.word.checkbox.checked
		})
		items.word.button.addEventListener('click', () => {
			textareas.show('word')
		})
		items.image.checkbox.addEventListener('change', () => {
			items.image.button.disabled = !(items.thumbnail.checkbox.checked && items.image.checkbox.checked)
		})
		items.image.button.addEventListener('click', () => {
			textareas.show('image')
		})

		buttons.ok.addEventListener('click', () => {
			menu.hide()
			save()
			load()
		})
		buttons.cancel.addEventListener('click', () => {
			menu.hide()
			load()
		})

		menu.self.addEventListener('mousedown', e => {
			if (e.target !== menu.self) {
				return
			}
			window.addEventListener('mouseup', () => {
				if (e.target !== menu.self) {
					return
				}
				menu.hide()
				load()
			}, { once: true })
		})
		textareaContainer.addEventListener('mousedown', e => {
			if (e.target !== textareaContainer) {
				return
			}
			window.addEventListener('mouseup', () => {
				if (e.target !== textareaContainer) {
					return
				}
				textareas.hide()
			}, { once: true })
		})

		load()
		document.body.appendChild(menu.self)
		document.body.appendChild(textareaContainer)
		document.body.appendChild(menuToggleButton)
		return true
	}
}