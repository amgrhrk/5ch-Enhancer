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
    //const placeholderSrc = (width, height) => `data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"%3E%3C/svg%3E`;
    const trimTwitterImageUrl = (url) => {
        if (!url.includes('twimg')) { return url; }
        //const matchResult = url.matches(/twimg(.+?(name=|:))?/);
        if (url.endsWith(':orig') || url.endsWith('name=orig')) { return url; }
        if (url.endsWith('&')) {
            url += 'name=orig';
        } else if (!url.replace('://', '').includes(':')) {
            url += ':orig';
        }
        return url;
    };

    const settings = JSON.parse(window.localStorage.getItem('5ch Enhancer')) || {
        isVisible: true,
        isDraggable: true,
        isEmbedded: true
    };

    const twttr = (function() {
        if (!settings.isEmbedded) { return null; }
        unsafeWindow.twttr = (function(d, s, id) {
            var js, fjs = d.getElementsByTagName(s)[0], t = unsafeWindow.twttr || {};
            if (d.getElementById(id)) return t;
            js = d.createElement(s);
            js.id = id;
            js.src = 'https://platform.twitter.com/widgets.js';
            fjs.parentNode.insertBefore(js, fjs);
            t._e = [];
            t.ready = function(f) {
                t._e.push(f);
            };
            return t;
        }(unsafeWindow.document, "script", "twitter-wjs"));
        return unsafeWindow.twttr;
    })();

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
                const lastOption = document.querySelector('div.option_style_8');
                const disables = [];

                const thumbnailOption = document.createElement('div');
                thumbnailOption.style.marginBottom = '10px';
                thumbnailOption.innerText = 'サムネイル画像を表示する';
                const thumbnailCheckbox = document.createElement('input');
                thumbnailCheckbox.type = 'checkbox';
                thumbnailCheckbox.checked = settings.isVisible;
                thumbnailCheckbox.classList.add('option_style_6');
                thumbnailCheckbox.addEventListener('click', () => {
                    disables.forEach(d => { d.disabled = !thumbnailCheckbox.checked });
                });
                thumbnailOption.insertBefore(thumbnailCheckbox, thumbnailOption.childNodes[0]);
                insertAfter(lastOption, thumbnailOption);

                const dragOption = document.createElement('div');
                dragOption.style.marginBottom = '10px';
                dragOption.innerText = 'ドラッグで画像を移動する';
                const dragCheckbox = document.createElement('input');
                dragCheckbox.type = 'checkbox';
                dragCheckbox.checked = settings.isDraggable;
                dragCheckbox.classList.add('option_style_6');
                dragCheckbox.disabled = !settings.isVisible;
                disables.push(dragCheckbox);
                dragOption.insertBefore(dragCheckbox, dragOption.childNodes[0]);
                insertAfter(thumbnailOption, dragOption);

                const embedOption = document.createElement('div');
                embedOption.style.marginBottom = '10px';
                embedOption.innerText = 'ツイートを埋め込む';
                const embedCheckbox = document.createElement('input');
                embedCheckbox.type = 'checkbox';
                embedCheckbox.checked = settings.isEmbedded;
                embedCheckbox.classList.add('option_style_6');
                embedOption.insertBefore(embedCheckbox, embedOption.childNodes[0]);
                insertAfter(dragOption, embedOption);

                const blockOption = document.createElement('div');
                blockOption.innerText = 'ブロック（未実装）';
                const blockButton = document.createElement('button');
                blockButton.innerText = '設定';
                blockButton.classList.add('btn');
                blockButton.onclick = () => {};
                blockOption.appendChild(blockButton);
                insertAfter(embedOption, blockOption);

                const saveButton = document.getElementById('saveOptions');
                saveButton.addEventListener('click', function(e) {
                    settings.isVisible = thumbnailCheckbox.checked;
                    settings.isDraggable = dragCheckbox.checked;
                    settings.isEmbedded = embedCheckbox.checked;
                    modal.img.draggable = !settings.isDraggable;
                    window.localStorage.setItem('5ch Enhancer', JSON.stringify(settings));
                });
            } catch (err) {}
        }, 2000);

        const urls = document.querySelectorAll('span.escaped a, dl.thread dd a');
        urls.forEach(url => {
            //const matchResult = url.href.match(/^https?:\/\/jump\..+?\/\?/);
            const matchResult = url.href.match(/^.+?\/\?./);
            if (matchResult) {
                //url.href = url.href.substring(matchResult[0].length);
                url.href = url.innerText;
            }
            if (settings.isEmbedded && url.innerText.match(/twitter\.com\/.+?\/status\/./)) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `https://publish.twitter.com/oembed?url=${url}`,
                    onload: function(response) {
                        const tweet = createTweet(response.responseText);
                        if (!tweet) { return; }
                        insertAfter(url, tweet);
                        if (tweet.nextElementSibling && tweet.nextElementSibling.tagName === 'BR') {
                            tweet.nextElementSibling.remove();
                        }
                        twttr.widgets.load(tweet);
                    }
                });
            } else if (settings.isVisible && url.innerText.match(/jpg|jpeg|gif|png|bmp/)) {
                appendImageAfter(url);
            }
        });
    });
})();