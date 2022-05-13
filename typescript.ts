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
        }
    }

    const settings = (() => {
        const defaultSettings = {
            isVisible: true,
            isDraggable: true,
            isEmbedded: true,
            isBlocked: true,
            blacklist: [] as string[]
        }
        return Object.assign(defaultSettings, GM_getValue('5ch Enhancer'))
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
                (entry.target as HTMLImageElement).src = (entry.target as HTMLImageElement).dataset.src ?? '';
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
                nextImg.src = nextImg.dataset.src ?? ''
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

        setTimeout(() => {
            if (!MenuOption.init(document.querySelector('div.option_style_8'))) { return }
            const thumbnailOption = new MenuOption({
                text: 'サムネイル画像を表示する',
                checked: settings.isVisible,
                onclick: MenuOption.toggleDisable,
                onconfirm: () => {
                    settings.isVisible = thumbnailOption.checkbox.checked
                },
                oncancel: () => {
                    thumbnailOption.checkbox.checked = settings.isVisible
                    MenuOption.toggleDisable.call(thumbnailOption.checkbox)
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
                    MenuOption.toggleDisable.call(blockOption.checkbox)
                }
            });
            (blockOption.checkbox as any).disables = []
            blockOption.button = document.createElement('button')
            blockOption.button.innerText = '設定'
            blockOption.button.classList.add('btn')
            blockOption.button.style.marginLeft = '4px'
            blockOption.div.appendChild(blockOption.button);
            (blockOption.checkbox as any).disables.push(blockOption.button)
            MenuOption.insert(thumbnailOption, dragOption, embedOption, blockOption)

            const blacklistOption = {
                container: document.createElement('div'),
                dialog: document.createElement('div'),
                textarea: document.createElement('textarea')
            }
            blacklistOption.container.style.display = 'none'
            blacklistOption.container.style.position = 'fixed'
            blacklistOption.container.style.top = '0'
            blacklistOption.container.style.left = '0'
            blacklistOption.container.style.width = '100%'
            blacklistOption.container.style.height = '100%'
            blacklistOption.container.style.zIndex = '14'
            blacklistOption.container.style.overflow = 'auto'
            blacklistOption.container.addEventListener('mouseup', (e) => e.stopPropagation())
            blacklistOption.container.addEventListener('click', () => {
                blacklistOption.container.style.display = 'none'
            })
            blacklistOption.dialog.style.position = 'relative'
            blacklistOption.dialog.style.margin = 'auto'
            blacklistOption.dialog.style.top = '15%'
            blacklistOption.dialog.style.width = '400px'
            blacklistOption.dialog.style.height = '500px'
            blacklistOption.dialog.style.padding = '20px'
            blacklistOption.dialog.style.backgroundColor = 'white'
            blacklistOption.dialog.style.overflow = 'hidden'
            blacklistOption.dialog.addEventListener('click', (e) => e.stopPropagation())
            blacklistOption.container.appendChild(blacklistOption.dialog)
            insertAfter(document.getElementById('optionView')!, blacklistOption.container)
            blockOption.button.onclick = () => {
                blacklistOption.container.style.display = ''
            }
            blacklistOption.textarea.style.boxSizing = 'border-box'
            blacklistOption.textarea.style.width = '100%'
            blacklistOption.textarea.style.height = '100%'
            blacklistOption.textarea.style.resize = 'none'
            blacklistOption.textarea.value = settings.blacklist.join('\n')
            blacklistOption.dialog.appendChild(blacklistOption.textarea)

            const saveButton = document.getElementById('saveOptions')
            saveButton?.addEventListener('click', () => {
                thumbnailOption.onconfirm()
                dragOption.onconfirm()
                embedOption.onconfirm()
                modal.img.draggable = !settings.isDraggable
                blockOption.onconfirm()
                settings.blacklist = blacklistOption.textarea.value.split('\n').filter(word => word.length > 0)
                GM_setValue('5ch Enhancer', settings)
                blacklistOption.textarea.value = settings.blacklist.join('\n')
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
                blacklistOption.textarea.value = settings.blacklist.join('\n')
            }
            cancels.forEach(cancel => cancel?.addEventListener('click', cancelF))
        }, 2000)

        if (settings.isBlocked && settings.blacklist.length > 0) {
            const comments = document.querySelectorAll<HTMLSpanElement>('span.escaped, dl.thread dd')
            comments.forEach(comment => {
                if (settings.blacklist.some(word => comment.innerText.includes(word))) {
                    comment.style.display = 'none'
                }
            })
        }

        const urls = document.querySelectorAll<HTMLAnchorElement>('span.escaped a, dl.thread dd a')
        urls.forEach(url => {
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
            } else if (settings.isVisible && url.innerText.match(/jpg|jpeg|gif|png|bmp/)) {
                const img = appendImageAfter(url)
                modal.imgs.map.set(img, modal.imgs.array.length)
                modal.imgs.array.push(img)
            }
        })
    })
})()