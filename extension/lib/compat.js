/* Chrome has no `browser` global; its MV3 `chrome.*` APIs return promises, which is enough here. */
"use strict";

if (typeof globalThis.browser === "undefined") globalThis.browser = chrome;
