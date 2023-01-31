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
			MenuItem.builder()
				.checkbox('embedThumbnails')
				.text('サムネイル画像を表示する')
				.build() as With<MenuItem, 'checkbox'>,
			MenuItem.builder()
				.checkbox('embedTweets')
				.text('ツイートを埋め込む')
				.build() as With<MenuItem, 'checkbox'>,
			MenuItem.builder()
				.checkbox('blockUsers')
				.text('NGユーザー')
				.button('設定')
				.textArea('blockedUsers')
				.build() as With<MenuItem, 'checkbox' | 'button' | 'textArea'>,
			MenuItem.builder()
				.checkbox('blockWords')
				.text('NGワード')
				.button('設定')
				.textArea('blockedWords')
				.build() as With<MenuItem, 'checkbox' | 'button' | 'textArea'>,
			MenuItem.builder()
				.checkbox('blockImages')
				.text('NG画像')
				.button('設定')
				.textArea('blockedImages')
				.build() as With<MenuItem, 'checkbox' | 'button' | 'textArea'>
		] as const
		MenuItem.Builder.disableOthersWhenUnchecked(items[0], items[4].checkbox, items[4].button)
		MenuItem.Builder.disableOthersWhenUnchecked(items[2], items[2].button)
		MenuItem.Builder.disableOthersWhenUnchecked(items[3], items[3].button)
		MenuItem.Builder.disableOthersWhenUnchecked(items[4], items[4].button)
		items.forEach(item => item.checkbox.checked = config[item.checkbox.key] as boolean)

		const popup = new Popup()
		popup.current = items[2].textArea
		const itemsWithTextArea = [items[2], items[3], items[4]] as const
		for (const item of itemsWithTextArea) {
			item.textArea.value = [...config[item.textArea.key] as Set<string>].join('\n')
			popup.window.appendChild(item.textArea)
			item.button.addEventListener('click', () => {
				popup.show(item)
			})
		}
		const confirmButton = document.getElementById('saveOptions')
		confirmButton?.addEventListener('click', () => {
			for (const item of itemsWithTextArea) {
				const values = new Set(item.textArea.value.split('\n'))
				values.delete('')
				;(config[item.textArea.key] as Set<string>) = values
			}
			config.save()
		})
		const cancelButtons = [
			document.getElementById('cancelOptions'),
			document.getElementById('close_options'),
			document.getElementById('option_container_bg')
		] as const
		for (const button of cancelButtons) {
			button?.addEventListener('click', () => {
				for (const item of itemsWithTextArea) {
					item.textArea.value = [...config[item.textArea!.key] as Set<string>].join('\n')
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

		show(menuItem: With<MenuItem, 'textArea'>) {
			menuItem.textArea!.classList.remove('vch-enhancer-hide')
			this.background.classList.remove('vch-enhancer-hide')
			this.current = menuItem.textArea
		}

		hide() {
			this.background.classList.add('vch-enhancer-hide')
			this.current.classList.add('vch-enhancer-hide')
		}
	}
}