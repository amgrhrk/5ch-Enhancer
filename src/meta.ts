// ==UserScript==
// @name         5ch-Enhancer
// @namespace    0hCM5sa3Sj9BjYg
// @version      0.2.1
// @description  Shows thumbnail previews, tweets, and blocks trolls for 5ch
// @description:ja 5ちゃんねるのスレ画像のサムネイルとツイートを表示します+NGユーザー/NGワード/NG画像
// @description:zh-cn 显示5ch串里图片链接的缩略图+屏蔽用户
// @author       文件
// @match        http://*.5ch.net/*
// @match        https://*.5ch.net/*
// @match        http://*.2ch.sc/*
// @match        https://*.2ch.sc/*
// @match        http://*.bbspink.com/*
// @match        https://*.bbspink.com/*
// @exclude      http://info.5ch.net/*
// @exclude      https://info.5ch.net/*
// @icon         https://www.google.com/s2/favicons?domain=5ch.net
// @run-at       document-start
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addElement
// @grant        GM_addStyle
// @grant        GM_getResourceURL
// @resource     twitter https://platform.twitter.com/widgets.js
// @resource     css https://cdn.jsdelivr.net/gh/amgrhrk/5ch-Enhancer/src/style.css
// @resource     hash https://cdn.jsdelivr.net/gh/amgrhrk/5ch-Enhancer/src/blockhash/bundled.js
// @require      https://cdn.jsdelivr.net/npm/@trim21/gm-fetch
// @connect      twitter.com
// @connect      twimg.com
// @connect      imgur.com
// ==/UserScript==

declare function GM_fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
declare function GM_setValue(name: string, value: any): void
declare function GM_getValue(name: string, defaultValue?: any): any
declare function GM_addElement<K extends keyof HTMLElementTagNameMap>(tagName: K, attributes: Partial<HTMLElementTagNameMap[K]>): HTMLElementTagNameMap[K]
declare function GM_addStyle(css: string): void
declare function GM_getResourceURL(name: string): string
declare const twttr: { widgets: { load: (container?: HTMLElement) => void } }

const scriptName = '5ch-Enhancer'
function log(...data: any[]) {
	console.log(`[${scriptName}]:`, ...data)
}