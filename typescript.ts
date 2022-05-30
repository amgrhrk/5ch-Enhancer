// ==UserScript==
// @name         5ch Enhancer
// @namespace    amgrhrk
// @version      0.1
// @description  Shows thumbnail previews and tweets for 5ch threads, and more.
// @description:ja 5ちゃんねるのスレにある画像のサムネイルとツイートを表示します+α
// @description:zh-cn 显示5ch串里图片链接的缩略图
// @author       文件
// @match        http://*.5ch.net/*
// @match        https://*.5ch.net/*
// @match        http://*.2ch.sc/*
// @match        https://*.2ch.sc/*
// @match        http://*.bbspink.com/*
// @match        https://*.bbspink.com/*
// @exclude      http://info.5ch.net/*
// @exclude      https://info.5ch.net/*
// @run-at       document-start
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      twitter.com
// @connect      imgur.com
// ==/UserScript==

(function () {
    "use strict"
    function GM_xmlhttpRequest(object: object) { }
    function GM_setValue(string: string, object: object) { }
    function GM_getValue(string: string, object?: object): any { }
    const BlockHash = {
        blockhash: (img: ArrayBuffer, bit: number, type: number, callback: (err: any, hash: string) => void) => { }
    }
    let unsafeWindow: any

    function insertAfter(first: Node, after: Node) {
        first.parentNode?.insertBefore(after, first.nextSibling)
    }

    function createTweet(json: string) {
        try {
            const obj = JSON.parse(json)
            const div = document.createElement('div')
            div.innerHTML = obj.html
            return div
        } catch (err) {
            return null
        }
    }

    function trimTwitterImageUrl(url: string) {
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
        for (const suffix of suffixes) {
            if (url.endsWith(suffix)) {
                return `${url.substring(0, url.length - suffix.length)}orig`
            }
        }
        return url
    }

    function getHash(img: ArrayBuffer): Promise<string>
    function getHash(img: HTMLImageElement): Promise<string>
    function getHash(img: ArrayBuffer | HTMLImageElement) {
        if (img instanceof ArrayBuffer) {
            return new Promise<string>((resolve, reject) => {
                (function retry(count=0) {
                    if (count === 3) { reject('Timeout') }
                    if (BlockHash && BlockHash.blockhash) {
                        BlockHash.blockhash(img, 16, 2, (err: any, hash: string) => {
                            if (err) { reject(err) }
                            resolve(hash)
                        })
                    } else {
                        setTimeout(retry, 5000, count + 1)
                    }
                })()
            })
        }
        return new Promise<string>((resolve, reject) => {
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            context!.drawImage(img, 0, 0)
            canvas.toBlob(blob => {
                blob!.arrayBuffer().then(data => {
                    (function retry(count=0) {
                        if (count === 3) { reject('Timeout') }
                        if (BlockHash && BlockHash.blockhash) {
                            BlockHash.blockhash(data, 16, 2, (err: any, hash: string) => {
                                if (err) { reject(err) }
                                resolve(hash)
                            })
                        } else {
                            setTimeout(retry, 5000, count + 1)
                        }
                    })()
                })
            }, 'image/jpeg', 100)
        })
    }

    function fetchAndHashImage(src: string, then: (hash: string) => void) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: src,
            responseType: 'arraybuffer',
            onload: (response: XMLHttpRequest) => {
                getHash(response.response as ArrayBuffer).then(then)
            }
        })
    }

    interface MenuOptionInit {
        text?: string
        checked?: boolean
        onclick?: () => void
        onconfirm: () => void
        oncancel: () => void
    }

    class MenuOption {
        private static head: { div: HTMLElement }

        div: HTMLDivElement
        checkbox: HTMLInputElement
        onconfirm: () => void
        oncancel: () => void

        constructor(init: MenuOptionInit) {
            this.div = document.createElement('div')
            this.checkbox = document.createElement('input')
            this.div.style.marginBottom = '10px'
            this.div.innerText = init.text || ''
            this.checkbox.type = 'checkbox'
            this.checkbox.checked = init.checked ?? false
            this.checkbox.classList.add('option_style_6')
            if (init.onclick) {
                this.checkbox.addEventListener('click', init.onclick)
            }
            this.onconfirm = init.onconfirm
            this.oncancel = init.oncancel
            this.div.insertBefore(this.checkbox, this.div.childNodes[0])
        }

        static insert(...options: MenuOption[]) {
            let prev = this.head
            options.forEach(option => {
                insertAfter(prev.div, option.div)
                prev = option
            })
            MenuOption.head = prev
        }

        static toggleDisable(this: (HTMLInputElement & { disables: (HTMLInputElement | HTMLButtonElement)[] })) {
            this.disables.forEach(d => {
                d.disabled = !this.checked
            })
        }

        static init(head: HTMLDivElement | null) {
            if (head) {
                this.head = { div: head }
                return true
            }
            return false
        }

        static addDisable(checkbox: HTMLInputElement, ...disables: (HTMLInputElement | HTMLButtonElement)[]) {
            const checkboxEx = checkbox as HTMLInputElement & { disables: (HTMLInputElement | HTMLButtonElement)[] }
            if (!checkboxEx.disables) {
                checkboxEx.disables = []
            }
            checkboxEx.disables = checkboxEx.disables.concat(disables)
        }
    }

    class MenuOptionWithButton extends MenuOption {
        button: HTMLButtonElement

        constructor(init: MenuOptionInit) {
            super(init)
            this.button = document.createElement('button')
            this.button.innerText = '設定'
            this.button.classList.add('btn')
            this.button.style.marginLeft = '4px'
            this.div.appendChild(this.button)
        }
    }

    class PopupWindow {
        container: HTMLDivElement
        dialog: HTMLDivElement
        textarea: HTMLTextAreaElement
        onconfirm: () => void
        oncancel: () => void

        constructor(openButton: HTMLButtonElement, set: Set<string>, onconfirm: () => void, oncancel: () => void) {
            this.container = document.createElement('div')
            this.container.style.display = 'none'
            this.container.style.position = 'fixed'
            this.container.style.top = '0'
            this.container.style.left = '0'
            this.container.style.width = '100%'
            this.container.style.height = '100%'
            this.container.style.zIndex = '14'
            this.container.style.overflow = 'auto'
            this.container.addEventListener('mouseup', (e) => e.stopPropagation())
            this.container.addEventListener('click', () => {
                this.container.style.display = 'none'
            })
            this.dialog = document.createElement('div')
            this.dialog.style.position = 'relative'
            this.dialog.style.margin = 'auto'
            this.dialog.style.top = '15%'
            this.dialog.style.width = '400px'
            this.dialog.style.height = '500px'
            this.dialog.style.padding = '20px'
            this.dialog.style.backgroundColor = 'white'
            this.dialog.style.overflow = 'hidden'
            this.dialog.addEventListener('click', (e) => e.stopPropagation())
            this.container.appendChild(this.dialog)
            insertAfter(document.getElementById('optionView')!, this.container)
            openButton.addEventListener('click', () => {
                this.container.style.display = ''
            })
            this.textarea = document.createElement('textarea')
            this.textarea.style.boxSizing = 'border-box'
            this.textarea.style.width = '100%'
            this.textarea.style.height = '100%'
            this.textarea.style.resize = 'none'
            this.textarea.value = Array.from(set).join('\n')
            this.dialog.appendChild(this.textarea)
            this.onconfirm = onconfirm
            this.oncancel = oncancel
        }
    }

    class FakeDiv {
        private styles: {
            display: string,
            width: string,
            height: string,
            padding: string,
            visibility: string
        }[]
        elements: HTMLElement[]
        isHidden: boolean

        constructor(...elements: HTMLElement[]) {
            this.elements = elements
            this.isHidden = false
            this.styles = new Array(elements.length).fill({
                display: '',
                width: '',
                height: '',
                padding: '',
                visibility: ''
            })
        }

        hide() {
            if (this.isHidden) { return }
            this.isHidden = true
            for (let i = 0; i < this.elements.length; i++) {
                this.styles[i].display = this.elements[i].style.display
                this.elements[i].style.display = 'none'
            }
        }

        show() {
            if (!this.isHidden) { return }
            this.isHidden = false
            for (let i = 0; i < this.elements.length; i++) {
                this.elements[i].style.display = this.styles[i].display
            }
        }

        minimize() {
            for (let i = 0; i < this.elements.length; i++) {
                this.styles[i].width = this.elements[i].style.width
                this.styles[i].height = this.elements[i].style.height
                this.styles[i].padding = this.elements[i].style.padding
                this.styles[i].visibility = this.elements[i].style.visibility
                this.elements[i].style.width = '0'
                this.elements[i].style.height = '0'
                this.elements[i].style.padding = '0'
                this.elements[i].style.visibility = 'hidden'
            }
        }

        restore() {
            for (let i = 0; i < this.elements.length; i++) {
                this.elements[i].style.width = this.styles[i].width
                this.elements[i].style.height = this.styles[i].height
                this.elements[i].style.padding = this.styles[i].padding
                this.elements[i].style.visibility = this.styles[i].visibility
            }
        }
    }

    abstract class Post {
        container: FakeDiv
        urls: HTMLAnchorElement[]
        abstract get name(): string
        abstract get id(): string
        abstract get isp(): string
        abstract get comment(): string

        constructor(container: FakeDiv, urls: HTMLAnchorElement[]) {
            this.container = container
            this.urls = urls
        }

        static getMostFrequentName(posts: Post[]) {
            const nameToCount = new Map<string, number>()
            let mostFrequentName = ''
            for (let i = 0; i < posts.length; i++) {
                const name = posts[i].name
                nameToCount.set(name, (nameToCount.get(name) || 0) + 1)
                if (nameToCount.get(name)! > (nameToCount.get(mostFrequentName) || 0)) {
                    mostFrequentName = name
                }
            }
            return mostFrequentName
        }
    }
    class NewPost extends Post {
        constructor(container: FakeDiv, urls: HTMLAnchorElement[]) {
            super(container, urls)
        }

        get name() {
            const fullNameNode = this.container.elements[0].firstElementChild!.children[1]
            const nameNode = fullNameNode.firstElementChild!
            return nameNode.textContent!
        }

        get isp() {
            const fullNameNode = this.container.elements[0].firstElementChild!.children[1]
            const nameNode = fullNameNode.firstElementChild!
            const ispNode = fullNameNode.lastElementChild!
            if (!ispNode || nameNode === ispNode) { return '' }
            return ispNode.tagName === 'B' ? ispNode.previousSibling!.textContent! : ispNode.lastChild!.previousSibling!.textContent!
        }

        get id() {
            return this.container.elements[0].firstElementChild!.lastElementChild!.textContent!
        }

        get comment() {
            return (this.container.elements[0].lastElementChild!.firstElementChild! as HTMLElement).innerText
        }
    }
    class OldPost extends Post {
        constructor(container: FakeDiv, urls: HTMLAnchorElement[]) {
            super(container, urls)
        }

        get name() {
            return this.container.elements[0].firstElementChild!.firstElementChild!.textContent!
        }

        get isp() {
            const ispNode = this.container.elements[0].firstElementChild!.firstElementChild!.nextSibling
            return ispNode ? ispNode.textContent! : ''
        }

        get id() {
            return this.container.elements[0].lastChild!.textContent!
        }

        get comment() {
            return this.container.elements[1].innerText
        }
    }

    const settings = (() => {
        const defaultSettings = {
            isVisible: true,
            isDraggable: true,
            isEmbedded: true,
            isBlocked: true,
            isSB: true,
            blacklist: new Set<string>(),
            sblist: new Set<string>(),
            save: () => {
                const gmSettings = Object.assign({} as any, defaultSettings)
                gmSettings.blacklist = Array.from(gmSettings.blacklist)
                gmSettings.sblist = Array.from(gmSettings.sblist)
                GM_setValue('5ch Enhancer', gmSettings)
            }
        }
        const gmSettings = GM_getValue('5ch Enhancer')
        if (Array.isArray(gmSettings.blacklist)) {
            gmSettings.blacklist = new Set<string>(gmSettings.blacklist)
        }
        if (Array.isArray(gmSettings.sblist)) {
            gmSettings.sblist = new Set<string>(gmSettings.sblist)
        }
        return Object.assign(defaultSettings, gmSettings as {})
    })()

    const twttr = (() => {
        if (!settings.isEmbedded) { return null }
        unsafeWindow.twttr = (function (d, s, id) {
            var js, fjs = d.getElementsByTagName(s)[0],
                t = unsafeWindow.twttr || {}
            if (d.getElementById(id)) return t
            js = d.createElement(s)
            js.id = id
            js.src = "https://platform.twitter.com/widgets.js"
            fjs.parentNode.insertBefore(js, fjs)
            t._e = []
            t.ready = function (f: any) {
                t._e.push(f)
            }
            return t
        }(unsafeWindow.document, "script", "twitter-wjs"))
        return unsafeWindow.twttr
    })();

    (() => {
        if (!settings.isSB) { return }
        unsafeWindow.BlockHash = ((d, id) => {
            const t = unsafeWindow.BlockHash || {}
            if (d.getElementById(id)) { return t }
            const fjs = d.getElementsByTagName('script')[0]
            const js = d.createElement('script')
            js.id = id
            js.src = 'https://cdn.jsdelivr.net/gh/amgrhrk/5ch-Enhancer/blockhash.js'
            fjs.parentNode.insertBefore(js, fjs)
            t._e = []
            t.ready = function (f: any) {
                t._e.push(f)
            }
            return t
        })(unsafeWindow.document, 'blockhash')
    })()

    const observer: MutationObserver & { dealWith: (node: Node) => void } = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(addedNode => {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    observer.dealWith(addedNode)
                }
            })
        })
    }) as any

    observer.dealWith = (() => {
        const functionMap: Record<string, () => void> = {}
        functionMap['https://agree.5ch.net/js/thumbnailer.js'] = function (this: HTMLElement) {
            this.remove()
        }
        return (node: Node) => {
            const f = functionMap[(node as any).src]
            if (f) {
                f.call(node)
            }
        }
    })()

    observer.observe(document, { childList: true, subtree: true })

    const imgObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    if (!entry.isIntersecting) { return }
                    (entry.target as HTMLImageElement).src = (entry.target as HTMLImageElement).dataset.src!
                    imgObserver.unobserve(entry.target)
                }, 500)
            }
        })
    }, { rootMargin: `${window.innerHeight}px` })
    const divObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                (entry.target as any).imgs.forEach((img: HTMLImageElement) => {
                    if (img.src === '') {
                        img.src = img.dataset.src!
                    }
                })
                divObserver.unobserve(entry.target)
            }
        })
    }, { rootMargin: `${window.innerHeight}px` } )

    document.addEventListener('DOMContentLoaded', () => {
        observer.disconnect()

        const scroll = document.createElement('div')
        scroll.style.fontSize = '50px'
        scroll.style.position = 'fixed'
        scroll.style.bottom = '5%'
        scroll.style.right = '4%'
        scroll.style.zIndex = '2'
        scroll.draggable = false
        scroll.style.userSelect = 'none'
        scroll.innerText = '🔼'
        scroll.onmouseover = () => scroll.style.filter = 'brightness(0.8)'
        scroll.onmousedown = () => scroll.style.filter = 'brightness(0.6)'
        scroll.onmouseup = () => scroll.style.filter = 'brightness(0.8)'
        scroll.onmouseout = () => scroll.style.filter = ''
        scroll.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' })
        document.body.appendChild(scroll)

        const threads = document.querySelector('div.THREAD_MENU > div')
        if (threads) {
            for (const thread of threads.children) {
                const number = thread.firstElementChild as HTMLAnchorElement
                const title = thread.lastElementChild as HTMLAnchorElement
                title.href = number.href.slice(0, -3)
                title.target = '_blank'
                title.rel = 'noopener'
            }
        }

        const modal = {
            imgs: {
                map: new Map<HTMLImageElement, number>(),
                array: [] as HTMLImageElement[],
                index: 0
            },
            container: document.createElement('div'),
            img: document.createElement('img'),
            isDown: false,
            isDragging: false,
            startX: 0,
            startY: 0,
            previousX: 0,
            previousY: 0,
            overflow: ''
        }

        modal.container.style.display = 'none'
        modal.container.style.position = 'fixed'
        modal.container.style.top = '0'
        modal.container.style.left = '0'
        modal.container.style.width = '100%'
        modal.container.style.height = '100%'
        modal.container.style.zIndex = '2'
        modal.container.style.overflow = 'auto'
        window.addEventListener('keydown', (e) => {
            if (modal.container.style.display === 'none' || e.repeat || modal.imgs.array.length === 0) { return }
            switch (e.keyCode) {
                case 65:
                case 87:
                    modal.imgs.index--
                    break
                case 68:
                case 83:
                    modal.imgs.index++
                    break
            }
            if (modal.imgs.index < 0) {
                modal.imgs.index = modal.imgs.array.length - 1
            } else if (modal.imgs.index >= modal.imgs.array.length) {
                modal.imgs.index = 0
            }
            const nextImg = modal.imgs.array[modal.imgs.index]
            if (nextImg.src === '') {
                nextImg.src = nextImg.dataset.src!
                imgObserver.unobserve(nextImg)
            }
            modal.img.src = nextImg.src
        })
        modal.container.addEventListener("click", () => {
            if (modal.isDragging && settings.isDraggable) { return }
            modal.container.style.display = 'none'
            document.body.style.overflow = modal.overflow
        })
        modal.container.addEventListener('mousedown', (e) => {
            if (!settings.isDraggable) { return }
            modal.isDown = true
            modal.isDragging = false
            modal.startX = e.screenX
            modal.startY = e.screenY
        })
        window.addEventListener('mousemove', (e) => {
            if (!settings.isDraggable) { return }
            const threshold = 1
            const deltaX = Math.abs(e.screenX - modal.previousX)
            const deltaY = Math.abs(e.screenY - modal.previousY)
            modal.previousX = e.screenX
            modal.previousY = e.screenY
            if (deltaX <= threshold && deltaY <= threshold) { return }
            if (modal.isDown) {
                modal.isDragging = true
                modal.container.scrollBy(modal.startX - e.screenX, modal.startY - e.screenY)
                modal.startX = e.screenX
                modal.startY = e.screenY
            } else {
                modal.isDragging = false
            }
        })
        window.addEventListener('mouseup', () => {
            if (!settings.isDraggable) { return }
            modal.isDown = false
        })
        modal.img.style.margin = 'auto'
        modal.img.draggable = !settings.isDraggable
        modal.container.appendChild(modal.img)
        document.body.appendChild(modal.container)

        const imgOnclick = function (this: HTMLImageElement) {
            modal.imgs.index = modal.imgs.map.get(this) || 0
            modal.img.src = this.src
            modal.overflow = document.body.style.overflow
            document.body.style.overflow = 'hidden'
            modal.container.style.display = 'flex'
        }
        const appendImageAfter = (element: HTMLElement) => {
            const fragment = document.createDocumentFragment()
            fragment.appendChild(document.createElement('br'))
            const img = new Image()
            img.dataset.src = trimTwitterImageUrl(element.innerText)
            img.style.maxWidth = '800px'
            img.addEventListener('click', imgOnclick)
            imgObserver.observe(img)
            fragment.appendChild(img)
            insertAfter(element, fragment)
            return img
        }

        const enum MenuState { CREATED, NOT_CREATED, NOT_APPLICABLE }
        let menuState = MenuState.NOT_CREATED
        const createMenu = () => {
            if (!window.location.pathname.includes('read.cgi')) {
                menuState = MenuState.NOT_APPLICABLE
                return
            }
            if (!MenuOption.init(document.querySelector('div.option_style_8'))) {
                menuState = MenuState.NOT_CREATED
                return
            }
            menuState = MenuState.CREATED
            const thumbnailOption = new MenuOption({
                text: 'サムネイル画像を表示する',
                checked: settings.isVisible,
                onclick: MenuOption.toggleDisable,
                onconfirm: () => {
                    settings.isVisible = thumbnailOption.checkbox.checked
                },
                oncancel: () => {
                    thumbnailOption.checkbox.checked = settings.isVisible
                    MenuOption.toggleDisable.call(thumbnailOption.checkbox as any)
                }
            });
            const dragOption = new MenuOption({
                text: 'ドラッグで画像を移動する',
                checked: settings.isDraggable,
                onconfirm: () => {
                    settings.isDraggable = dragOption.checkbox.checked
                },
                oncancel: () => {
                    dragOption.checkbox.checked = settings.isDraggable
                }
            })
            dragOption.checkbox.disabled = !settings.isVisible;
            MenuOption.addDisable(thumbnailOption.checkbox, dragOption.checkbox)
            const embedOption = new MenuOption({
                text: 'ツイートを埋め込む',
                checked: settings.isEmbedded,
                onconfirm: () => {
                    settings.isEmbedded = embedOption.checkbox.checked
                },
                oncancel: () => {
                    embedOption.checkbox.checked = settings.isEmbedded
                }
            })
            const blockOption = new MenuOptionWithButton({
                text: 'NGワード',
                checked: settings.isBlocked,
                onclick: MenuOption.toggleDisable,
                onconfirm: () => {
                    settings.isBlocked = blockOption.checkbox.checked
                },
                oncancel: () => {
                    blockOption.checkbox.checked = settings.isBlocked
                    MenuOption.toggleDisable.call(blockOption.checkbox as any)
                }
            })
            blockOption.button.disabled = !settings.isBlocked
            MenuOption.addDisable(blockOption.checkbox, blockOption.button)
            const blockOptionPopupWindow = new PopupWindow(
                blockOption.button, settings.blacklist,
                () => {
                    settings.blacklist = new Set(blockOptionPopupWindow.textarea.value.split('\n').filter(word => word.length > 0))
                    blockOptionPopupWindow.textarea.value = Array.from(settings.blacklist).join('\n')
                },
                () => {
                    blockOptionPopupWindow.textarea.value = Array.from(settings.blacklist).join('\n')
                }
            )
            const sbiPhoneOption = new MenuOptionWithButton({
                text: 'SB-iPhone特殊対策',
                checked: settings.isSB,
                onclick: MenuOption.toggleDisable,
                onconfirm: () => {
                    settings.isSB = sbiPhoneOption.checkbox.checked
                },
                oncancel: () => {
                    sbiPhoneOption.checkbox.checked = settings.isSB
                    MenuOption.toggleDisable.call(sbiPhoneOption.checkbox as any)
                }
            })
            sbiPhoneOption.button.disabled = !settings.isSB
            MenuOption.addDisable(sbiPhoneOption.checkbox, sbiPhoneOption.button)
            thumbnailOption.checkbox.addEventListener('click', () => {
                if (sbiPhoneOption.checkbox.checked && !thumbnailOption.checkbox.checked) {
                    alert('サムネイルをオフにしつつSB-iPhone対策をオンにするとすべてのSB-iPhoneのスレが表示しなくなります')
                }
            })
            sbiPhoneOption.checkbox.addEventListener('click', () => {
                if (sbiPhoneOption.checkbox.checked && !thumbnailOption.checkbox.checked) {
                    alert('サムネイルをオフにしつつSB-iPhone対策をオンにするとすべてのSB-iPhoneのスレが表示しなくなります')
                }
            })
            const sbiPhoneOptionPopupWindow = new PopupWindow(
                sbiPhoneOption.button, settings.sblist,
                () => {
                    settings.sblist = new Set(sbiPhoneOptionPopupWindow.textarea.value.split('\n').filter(word => word.length > 0))
                    sbiPhoneOptionPopupWindow.textarea.value = Array.from(settings.sblist).join('\n')
                },
                () => {
                    sbiPhoneOptionPopupWindow.textarea.value = Array.from(settings.sblist).join('\n')
                }
            )
            MenuOption.insert(thumbnailOption, dragOption, embedOption, blockOption, sbiPhoneOption)

            const saveButton = document.getElementById('saveOptions')
            saveButton?.addEventListener('click', () => {
                thumbnailOption.onconfirm()
                dragOption.onconfirm()
                embedOption.onconfirm()
                modal.img.draggable = !settings.isDraggable
                blockOption.onconfirm()
                blockOptionPopupWindow.onconfirm()
                sbiPhoneOption.onconfirm()
                sbiPhoneOptionPopupWindow.onconfirm()
                settings.save()
            })
            const cancels = [
                document.getElementById('cancelOptions'),
                document.getElementById('close_options'),
                document.querySelector('div.option_container_bg')
            ]
            const oncancel = () => {
                thumbnailOption.oncancel()
                dragOption.oncancel()
                embedOption.oncancel()
                blockOption.oncancel()
                blockOptionPopupWindow.oncancel()
                sbiPhoneOption.oncancel()
                sbiPhoneOptionPopupWindow.oncancel()
            }
            cancels.forEach(cancel => cancel?.addEventListener('click', oncancel))
        }
        setTimeout(createMenu, 2000)

        const posts: Post[] = (() => {
            const newPostDivs = Array.from(document.querySelectorAll<HTMLDivElement>('div.post'))
            if (newPostDivs.length !== 0) {
                const newPosts: Post[] = newPostDivs.map(newPostDiv => {
                    const br = newPostDiv.nextElementSibling as HTMLElement
                    return new NewPost(
                        new FakeDiv(newPostDiv, br),
                        Array.from(newPostDiv.querySelectorAll<HTMLAnchorElement>('span.escaped a'))
                    )
                })
                return newPosts
            }
            const oldPostTitles = Array.from(document.querySelectorAll<HTMLElement>('dl.thread > dt'))
            const oldPosts: Post[] = oldPostTitles
                .filter(oldPostTitles => oldPostTitles.nextElementSibling !== null)
                .map(oldPostTitle => {
                    const oldPostContent = oldPostTitle.nextElementSibling as HTMLElement
                    return new OldPost(
                        new FakeDiv(oldPostTitle, oldPostContent),
                        Array.from(oldPostContent.querySelectorAll('a'))
                    )
                })
            return oldPosts
        })()

        const mostFrequentName = Post.getMostFrequentName(posts)
        posts.forEach(post => {
            const isSbiPhone = post.isp === '(SB-iPhone)'
            let observedDiv: HTMLDivElement & { imgs: HTMLImageElement[], post: Post, count: number, containsBlockedImage: boolean }
            let forceHidden = false
            if (!post.container.isHidden && settings.isSB && isSbiPhone) {
                if (!settings.isVisible || post.name !== mostFrequentName) {
                    post.container.hide()
                    forceHidden = true
                }
                if (post.urls.length > 0) {
                    post.container.hide()
                }
            }
            if (!post.container.isHidden && settings.isBlocked) {
                if (Array.from(settings.blacklist).some(word => post.comment.includes(word))) {
                    post.container.hide()
                    forceHidden = true
                }
            }
            post.urls.forEach(url => {
                const matchResult = url.href.match(/^.+?\/\?./)
                if (matchResult) {
                    url.href = url.innerText
                }
                if (settings.isEmbedded && url.innerText.match(/twitter\.com\/.+?\/status\/./)) {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `https://publish.twitter.com/oembed?url=${url.innerText}&omit_script=true`,
                        onload: (response: XMLHttpRequest) => {
                            const tweet = createTweet(response.responseText)
                            if (!tweet) { return }
                            insertAfter(url, tweet)
                            if (tweet.nextElementSibling && tweet.nextElementSibling.tagName === 'BR') {
                                tweet.nextElementSibling.remove()
                            }
                            (function retry(count=0) {
                                if (count === 3) { return }
                                if (twttr.widgets && twttr.widgets.load) {
                                    twttr.widgets.load(tweet)
                                } else {
                                    setTimeout(retry, 5000, count + 1)
                                }
                            })()
                        }
                    })
                }
                if (settings.isVisible && url.innerText.match(/jpg|jpeg|gif|png|bmp/)) {
                    const img = appendImageAfter(url)
                    modal.imgs.map.set(img, modal.imgs.array.length)
                    modal.imgs.array.push(img)
                    if (settings.isSB && img.dataset.src!.match(/^https?:\/\/(i\.)?imgur/) && img.dataset.src!.endsWith('jpg')) {
                        const space = document.createTextNode('\xa0\xa0')
                        const blockButton = document.createElement('a')
                        blockButton.innerText = 'ブロック'
                        blockButton.href = 'javascript:void(0)'
                        blockButton.addEventListener('click', () => {
                            post.container.hide()
                            if (img.src === '') {
                                img.src = img.dataset.src!
                                imgObserver.unobserve(img)
                            }
                            if (img.complete) {
                                fetchAndHashImage(img.dataset.src!, (hash) => {
                                    settings.sblist.add(hash)
                                    settings.save()
                                })
                            } else {
                                img.addEventListener('load', () => {
                                    fetchAndHashImage(img.dataset.src!, (hash) => {
                                        settings.sblist.add(hash)
                                        settings.save()
                                    })
                                })
                            }
                        })
                        insertAfter(url, space)
                        insertAfter(space, blockButton)
                        if (isSbiPhone) {
                            if (!observedDiv) {
                                const currentDiv = post.container.elements[0]
                                observedDiv = document.createElement('div') as any
                                observedDiv.imgs = []
                                observedDiv.post = post;
                                observedDiv.count = 0
                                currentDiv.parentElement!.insertBefore(observedDiv, currentDiv)
                                divObserver.observe(observedDiv)
                            }
                            observedDiv.imgs.push(img)
                            img.addEventListener('load', () => {
                                if (observedDiv.containsBlockedImage) { return }
                                fetchAndHashImage(img.dataset.src!, (hash) => {
                                    observedDiv.count++
                                    if (settings.sblist.has(hash)) {
                                        observedDiv.containsBlockedImage = true
                                    }
                                    if (observedDiv.count === observedDiv.imgs.length && !observedDiv.containsBlockedImage && !forceHidden) {
                                        observedDiv.post.container.show()
                                    }
                                })
                            })
                        } else {
                            img.addEventListener('load', () => {
                                if (post.container.isHidden) { return }
                                fetchAndHashImage(img.dataset.src!, (hash) => {
                                    if (settings.sblist.has(hash)) {
                                        post.container.hide()
                                    }
                                })
                            })
                        }
                    }
                }
            })
        })
    })
})()