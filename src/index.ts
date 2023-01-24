GM_addElement('link', { rel: 'stylesheet', href: GM_getResourceURL('css') })

const config = new Config()
if (config.embedTweets) {
	Twitter.init()
}

const hash = config.embedThumbnails
	? new Images.Hash(GM_getResourceURL('hash'))
	: null

const remover = new MutationObserver(mutations => {
	for (const mutation of mutations) {
		for (const addedNode of mutation.addedNodes) {
			if (addedNode.nodeType === Node.ELEMENT_NODE) {
				const node = addedNode as HTMLScriptElement
				if (node.src === 'https://agree.5ch.net/js/thumbnailer.js') {
					node.remove()
				}
			}
		}
	}
})
remover.observe(document, { childList: true, subtree: true })

document.addEventListener('DOMContentLoaded', () => {
	remover.disconnect()

	const modal = config.embedThumbnails
		? new Modal()
		: null

	const scrollButton = document.createElement('button')
	scrollButton.innerText = '🔼'
	scrollButton.draggable = false
	scrollButton.classList.add('vch-enhancer-scroll-button')
	scrollButton.addEventListener('click', () => {
		window.scrollTo({ top: 0, behavior: 'smooth' })
	})
	document.body.appendChild(scrollButton)

	const threads = document.querySelector('.THREAD_MENU > div')
	if (threads) {
		for (const thread of threads.children) {
			const number = thread.firstElementChild as HTMLAnchorElement
			const title = thread.lastElementChild as HTMLAnchorElement
			title.href = number.href.slice(0, -3)
			title.target = '_blank'
			title.rel = 'noopener noreferrer'
		}
	} else {
		setTimeout(Menu.retry, 1000, config, 0)
	}

	const posts: Post[] = threads
		? [...document.querySelectorAll<HTMLElement>('dl.thread > dt')]
			.map(dt => new OldPost(dt, dt.nextElementSibling as HTMLElement))
		: [...document.querySelectorAll<HTMLDivElement>('div.post')]
			.map(div => new NewPost(div))
	for (const post of posts) {
		if (post.nameOrIspIncludesAnyOf(config.blockedUsers)
			|| post.contentIncludesAnyOf(config.blockedWords)) {
			post.hide()
			continue
		}
		for (const url of post.urls) {
			url.href = Twitter.trim(url.innerText)
		}
		post.convertTextToUrl()
		if (config.embedThumbnails) {
			embedThumbnails(post, config, modal!, hash!)
		}
		if (config.embedTweets) {
			embedTweets(post)
		}
	}
})