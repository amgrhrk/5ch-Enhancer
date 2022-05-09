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
// @run-at       document-start
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_xmlhttpRequest
// @connect      twitter.com
// ==/UserScript==

(function() {
    'use strict';
    const insertAfter = (first, after) => {
        first.parentNode.insertBefore(after, first.nextSibling);
    };
    const createTweet = (json) => {
        try {
            const obj = JSON.parse(json);
            const div = document.createElement('div');
            div.innerHTML = obj.html;
            return div;
        } catch (err) {}
    };
    const trimTwitterImageUrl = (url) => {
        if (!url.includes('twimg')) {
            return url;
        }
        if (url.endsWith('orig')) {
            return url;
        }
        if (url.endsWith('&')) {
            return `${url}name=orig`;
        }
        const suffixes = ['large', 'medium', 'small', '900x900', 'thumb'];
        for (const suffix of suffixes) {
            if (url.endsWith(suffix)) {
                return `${url.substring(0, url.length - suffix.length)}orig`;
            }
        }
        return url;
    };
    const MenuOptions = {
        head: null,
        init: (head) => {
            MenuOptions.head = {div: head};
        },
        create: (text, checked=true) => {
            const o = {
                div: document.createElement('div'),
                checkbox: document.createElement('input')
            };
            o.div.style.marginBottom = '10px';
            o.div.innerText = text;
            o.checkbox.type = 'checkbox';
            o.checkbox.checked = checked;
            o.checkbox.classList.add('option_style_6');
            o.div.insertBefore(o.checkbox, o.div.childNodes[0]);
            return o;
        },
        insert: (...options) => {
            let prev = MenuOptions.head;
            options.forEach(option => {
                insertAfter(prev.div, option.div);
                prev = option;
            });
            MenuOptions.head = prev;
        }
    };

    const settings = JSON.parse(window.localStorage.getItem('5ch Enhancer')) || {
        isVisible: true,
        isDraggable: true,
        isEmbedded: true
    };

    if (settings.isEmbedded) {
        window.twttr = (function(d, s, id) {
            var js, fjs = d.getElementsByTagName(s)[0],
                t = window.twttr || {};
            if (d.getElementById(id)) return t;
            js = d.createElement(s);
            js.id = id;
            js.src = "https://platform.twitter.com/widgets.js";
            fjs.parentNode.insertBefore(js, fjs);
            t._e = [];
            t.ready = function(f) {
                t._e.push(f);
            };
            return t;
        }(document, "script", "twitter-wjs"));
    }

    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(addedNode => {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    observer.dealWith(addedNode);
                }
            });
        });
    });
    observer.dealWith = (() => {
        const functionMap = {};
        functionMap['https://agree.5ch.net/js/thumbnailer.js'] = function() {
            this.remove();
        };
        return (node) => {
            const f = functionMap[node.src];
            if (f) {
                f.call(node);
            }
        };
    })();
    observer.observe(document, { childList: true, subtree: true });

    const imgObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.src = entry.target.dataset.src;
                imgObserver.unobserve(entry.target);
            }
        });
    });

    document.addEventListener('DOMContentLoaded', () => {
        observer.disconnect();

        const scroll = document.createElement('div');
        scroll.style.fontSize = '50px';
        scroll.style.position = 'fixed';
        scroll.style.bottom = '5%';
        scroll.style.right = '4%';
        scroll.style.zIndex = '2';
        scroll.draggable = false;
        scroll.style.userSelect = 'none';
        scroll.innerText = '🔼';
        scroll.onmouseover = () => {
            scroll.style.filter = 'brightness(0.8)';
        };
        scroll.onmousedown = () => {
            scroll.style.filter = 'brightness(0.6)';
        };
        scroll.onmouseup = () => {
            scroll.style.filter = 'brightness(0.8)';
        };
        scroll.onmouseout = () => {
            scroll.style.filter = '';
        };
        scroll.onclick = () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        document.body.appendChild(scroll);

        const threads = document.querySelector('div.THREAD_MENU > div');
        if (threads) {
            for (const thread of threads.children) {
                const number = thread.firstElementChild;
                const title = thread.lastElementChild;
                title.href = number.href.slice(0, -3);
                title.target = '_blank';
                title.rel = 'noopener';
            }
        }

        const modal = {};
        modal.container = document.createElement('div');
        modal.container.style.display = 'none';
        modal.container.style.position = 'fixed';
        modal.container.style.top = '0';
        modal.container.style.left = '0';
        modal.container.style.width = '100%';
        modal.container.style.height = '100%';
        modal.container.style.zIndex = '2';
        modal.container.style.overflow = 'auto';
        modal.container.addEventListener("click", function() {
            if (modal.isDragging && settings.isDraggable) { return; }
            modal.container.style.display = 'none';
            document.body.style.overflow = modal.overflow;
        });
        modal.container.addEventListener('mousedown', function(e) {
            if (!settings.isDraggable) { return; }
            modal.isDown = true;
            modal.isDragging = false;
            modal.startX = e.screenX;
            modal.startY = e.screenY;
        });
        window.addEventListener('mousemove', function(e) {
            if (!settings.isDraggable) { return; }
            const threshold = 1;
            const deltaX = Math.abs(e.screenX - modal.previousX);
            const deltaY = Math.abs(e.screenY - modal.previousY);
            modal.previousX = e.screenX;
            modal.previousY = e.screenY;
            if (deltaX <= threshold && deltaY <= threshold) { return; }
            if (modal.isDown) {
                modal.isDragging = true;
                modal.container.scrollBy(modal.startX - e.screenX, modal.startY - e.screenY);
                modal.startX = e.screenX;
                modal.startY = e.screenY;
            } else {
                modal.isDragging = false;
            }
        });
        window.addEventListener('mouseup', function() {
            if (!settings.isDraggable) { return; }
            modal.isDown = false;
        });
        modal.img = document.createElement('img');
        modal.img.style.margin = 'auto';
        modal.img.draggable = !settings.isDraggable;
        modal.container.appendChild(modal.img);
        document.body.appendChild(modal.container);

        const imgOnclick = function() {
            modal.img.src = this.src;
            modal.overflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            modal.container.style.display = 'flex';
        };
        const appendImageAfter = (element) => {
            const fragment = document.createDocumentFragment();
            fragment.appendChild(document.createElement('br'));
            const img = new Image();
            img.dataset.src = trimTwitterImageUrl(element.innerText);
            img.style.maxWidth = '800px';
            img.addEventListener('click', imgOnclick);
            imgObserver.observe(img);
            fragment.appendChild(img);
            insertAfter(element, fragment);
        };

        setTimeout(() => {
            try {
                MenuOptions.init(document.querySelector('div.option_style_8'));

                const thumbnailOption = MenuOptions.create('サムネイル画像を表示する', settings.isVisible);
                thumbnailOption.disables = [];
                thumbnailOption.checkbox.addEventListener('click', () => {
                    thumbnailOption.disables.forEach(d => { d.disabled = !thumbnailOption.checkbox.checked });
                });

                const dragOption = MenuOptions.create('ドラッグで画像を移動する', settings.isDraggable);
                dragOption.checkbox.disabled = !settings.isVisible;
                thumbnailOption.disables.push(dragOption.checkbox);

                const embedOption = MenuOptions.create('ツイートを埋め込む', settings.isEmbedded);

                const blockOption = {
                    div: document.createElement('div'),
                    button: document.createElement('button')
                };
                blockOption.div.innerText = 'ブロック（未実装）';
                blockOption.button.innerText = '設定';
                blockOption.button.classList.add('btn');
                blockOption.button.onclick = () => {};
                blockOption.div.appendChild(blockOption.button);

                MenuOptions.insert(thumbnailOption, dragOption, embedOption, blockOption);

                const saveButton = document.getElementById('saveOptions');
                saveButton.addEventListener('click', () => {
                    settings.isVisible = thumbnailOption.checkbox.checked;
                    settings.isDraggable = dragOption.checkbox.checked;
                    settings.isEmbedded = embedOption.checkbox.checked;
                    modal.img.draggable = !settings.isDraggable;
                    window.localStorage.setItem('5ch Enhancer', JSON.stringify(settings));
                });
            } catch (err) {}
        }, 2000);

        const urls = document.querySelectorAll('span.escaped a, dl.thread dd a');
        urls.forEach(url => {
            const matchResult = url.href.match(/^.+?\/\?./);
            if (matchResult) {
                url.href = url.innerText;
            }
            if (settings.isEmbedded && url.innerText.match(/twitter\.com\/.+?\/status\/./)) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://publish.twitter.com/oembed?url=${url.innerText}`,
                    onload: function(response) {
                        const tweet = createTweet(response.responseText);
                        if (!tweet) { return; }
                        insertAfter(url, tweet);
                        if (tweet.nextElementSibling && tweet.nextElementSibling.tagName === 'BR') {
                            tweet.nextElementSibling.remove();
                        }
                    }
                });
            } else if (settings.isVisible && url.innerText.match(/jpg|jpeg|gif|png|bmp/)) {
                appendImageAfter(url);
            }
        });
    });
})();