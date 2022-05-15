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
    function GM_getValue(string: string, object?: object) { }
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
                        if (BlockHash && BlockHash.blockhash) {
                            BlockHash.blockhash(data, 16, 2, (err: any, hash: string) => {
                                if (err) { reject(err) }
                                resolve(hash)
                            })
                        } else {
                            setTimeout(retry, 5000, count + 1)
                        }
                    })()
                });
            }, 'image/jpeg', 100)
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
            this.div.innerText = init.text ?? ''
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

        static toggleDisable(this: (HTMLInputElement & {disables: HTMLInputElement[] | HTMLButtonElement[]})) {
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
    }

    class MenuOptionWithButton extends MenuOption {
        button: HTMLButtonElement

        constructor(init: MenuOptionInit) {
            super(init)
            this.button = document.createElement('button')
            this.button.innerText = '設定'
            this.button.classList.add('btn')
            this.button.style.marginLeft = '4px'
            this.div.appendChild(this.button);
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
                const gmSettings: any = {}
                Object.assign(gmSettings, defaultSettings)
                gmSettings.blacklist = Array.from(gmSettings.blacklist)
                gmSettings.sblist = Array.from(gmSettings.sblist)
                GM_setValue('5ch Enhancer', gmSettings)
            }
        }
        const gmSettings = GM_getValue('5ch Enhancer')
        if (Array.isArray((gmSettings as any).blacklist)) {
            (gmSettings as any).blacklist = new Set<string>((gmSettings as any).blacklist)
        }
        if (Array.isArray((gmSettings as any).sblist)) {
            (gmSettings as any).sblist = new Set<string>((gmSettings as any).sblist)
        }
        return Object.assign(defaultSettings, gmSettings)
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
            t._e = [];
            t.ready = function (f: any) {
                t._e.push(f)
            }
            return t
        })(unsafeWindow.document, 'blockhash');
    })()

    const observer: MutationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(addedNode => {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    (observer as any).dealWith(addedNode)
                }
            })
        })
    });

    (observer as any).dealWith = (() => {
        const functionMap: Record<string, () => void> = {}
        functionMap['https://agree.5ch.net/js/thumbnailer.js'] = function (this: HTMLElement) {
            this.remove()
        }
        return (node: HTMLScriptElement) => {
            const f = functionMap[node.src]
            if (f) {
                f.call(node)
            }
        }
    })()

    observer.observe(document, { childList: true, subtree: true })

    const imgObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                (entry.target as HTMLImageElement).src = (entry.target as HTMLImageElement).dataset.src!
                imgObserver.unobserve(entry.target)
            }
        })
    })

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
            modal.imgs.index = modal.imgs.map.get(this) ?? 0
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

        enum MenuState { CREATED, NOT_CREATED, NOT_APPLICABLE }
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
            (thumbnailOption.checkbox as any).disables = []
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
            (thumbnailOption.checkbox as any).disables.push(dragOption.checkbox)
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
            });
            blockOption.button.disabled = !settings.isBlocked;
            (blockOption.checkbox as any).disables = [];
            (blockOption.checkbox as any).disables.push(blockOption.button)
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
            });
            sbiPhoneOption.button.disabled = !settings.isSB;
            (sbiPhoneOption.checkbox as any).disables = [];
            (sbiPhoneOption.checkbox as any).disables.push(sbiPhoneOption.button)
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
            const cancelF = () => {
                thumbnailOption.oncancel()
                dragOption.oncancel()
                embedOption.oncancel()
                blockOption.oncancel()
                blockOptionPopupWindow.oncancel()
                sbiPhoneOption.oncancel()
                sbiPhoneOptionPopupWindow.oncancel()
            }
            cancels.forEach(cancel => cancel?.addEventListener('click', cancelF))
        }
        setTimeout(createMenu, 2000)

        if (settings.isBlocked && settings.blacklist.size > 0) {
            const comments = document.querySelectorAll<HTMLSpanElement>('span.escaped, dl.thread dd')
            comments.forEach(comment => {
                if (Array.from(settings.blacklist).some(word => comment.innerText.includes(word))) {
                    comment.style.display = 'none'
                }
            })
        }

        enum POST_TYPE { OLD, NEW }
        class Post {
            container: FakeDiv
            urls: HTMLAnchorElement[]
            type: POST_TYPE

            constructor(container: FakeDiv, urls: HTMLAnchorElement[], type: POST_TYPE) {
                this.container = container
                this.urls = urls
                this.type = type
            }

            get id() {
                if (this.type === POST_TYPE.OLD) {
                    return this.container.elements[0].lastChild?.textContent
                }
                return this.container.elements[0].firstElementChild?.lastElementChild?.textContent
            }

            get name() {
                if (this.type === POST_TYPE.OLD) {
                    return this.container.elements[0].firstElementChild?.childNodes[1].textContent
                }
                return this.container.elements[0].firstElementChild?.children[1].childNodes[1].textContent
            }
        }

        class FakeDiv {
            private displays: string[]
            elements: HTMLElement[]
            isHidden: boolean

            constructor(...elements: HTMLElement[]) {
                this.elements = elements
                this.isHidden = false
                this.displays = Array<string>(elements.length)
            }

            hide() {
                this.isHidden = true
                for (let i = 0; i < this.elements.length; i++) {
                    this.displays[i] = this.elements[i].style.display
                    this.elements[i].style.display = 'none'
                }
            }

            show() {
                this.isHidden = false
                for (let i = 0; i < this.elements.length; i++) {
                    this.elements[i].style.display = this.displays[i]
                }
            }
        }

        const posts: Post[] = (() => {
            const newPostDivs = Array.from(document.querySelectorAll<HTMLDivElement>('div.post'))
            if (newPostDivs.length !== 0) {
                const newPosts: Post[] = newPostDivs.map(newPostDiv => new Post(
                    new FakeDiv(newPostDiv),
                    Array.from(newPostDiv.querySelectorAll<HTMLAnchorElement>('span.escaped a')),
                    POST_TYPE.NEW
                ))
                return newPosts
            }
            const oldPostTitles = Array.from(document.querySelectorAll<HTMLElement>('dl.thread > dt'))
            const oldPosts: Post[] = oldPostTitles
                .filter(oldPostTitles => oldPostTitles.nextElementSibling !== null)
                .map(oldPostTitle => {
                    const oldPost = oldPostTitle.nextElementSibling as HTMLElement
                    return new Post(
                        new FakeDiv(oldPostTitle, oldPost),
                        Array.from(oldPost.querySelectorAll('a')),
                        POST_TYPE.OLD
                    )
                })
            return oldPosts
        })()

        const fetchImage = (src: string, then: (hash: string) => void) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: src,
                responseType: 'arraybuffer',
                onload: (response: XMLHttpRequest) => {
                    getHash(response.response as ArrayBuffer).then(then)
                }
            })
        }
        posts.forEach(post => {
            if (settings.isSB && post.name === '(SB-iPhone)' && !settings.isVisible) {
                post.container.hide()
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
                            (function retry(count = 0) {
                                if (count == 3) { return }
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
                        const blockImage = document.createElement('a')
                        blockImage.innerText = 'ブロック'
                        blockImage.href = 'javascript:void(0)'
                        blockImage.addEventListener('click', () => {
                            post.container.hide()
                            if (img.src === '') {
                                img.src = img.dataset.src!
                                imgObserver.unobserve(img)
                            }
                            if (img.complete) {
                                fetchImage(img.dataset.src!, (hash) => {
                                    settings.sblist.add(hash)
                                    settings.save()
                                })
                            } else {
                                img.addEventListener('load', () => {
                                    fetchImage(img.dataset.src!, (hash) => {
                                        settings.sblist.add(hash)
                                        settings.save()
                                    })
                                })
                            }
                        })
                        insertAfter(url, space)
                        insertAfter(space, blockImage)
                        img.addEventListener('load', () => {
                            if (post.container.isHidden) { return }
                            fetchImage(img.dataset.src!, (hash) => {
                                if (settings.sblist.has(hash)) {
                                    post.container.hide()
                                }
                            })
                        })
                    }
                }
            })
        })
    })
})()