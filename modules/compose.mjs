/*
 * Copyright (c) Jeevanandam M. (jeeva@myjeeva.com)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at
 * https://github.com/jeevatkm/ReplyWithHeaderMozilla/blob/master/LICENSE
 */

// RWH Compose Module

import { rwhLogger } from './logger.mjs';
import * as rwhSettings from './settings.mjs';
import * as rwhI18n from './headers-i18n.mjs';
import * as rwhAccounts from './accounts.mjs';
import * as rwhUtils from './utils.mjs';

const positionBeforeBegin = 'beforebegin';
const positionBeforeEnd = 'beforeend';
const positionAfterBegin = 'afterbegin';
const fwdHdrLookupString = '-------- ';
const plainTextFirstChars = '> ';
const cleanBlockQuoteStyle = 'border:none !important; padding-left:0 !important; margin-left:0 !important;';

export async function process(tab) {
    rwhLogger.debug(`tab.id=${tab.id}, tab.type=${tab.type}, tab.mailTab=${tab.mailTab}`);

    let composeDetails = await messenger.compose.getComposeDetails(tab.id);
    rwhLogger.debug(composeDetails);
    if (composeDetails.type === 'new') {
        rwhLogger.debug('New message getting composed');
        return;
    }

    // Check account level disable exists
    let accountId = await rwhAccounts.findIdByIdentityId(composeDetails.identityId);
    let isAccountEnabled = await rwhSettings.isAccountEnabled(accountId);
    rwhLogger.debug('AccountId', accountId, 'isAccountEnabled', isAccountEnabled);
    if (!isAccountEnabled) {
        return; // RWH stops here
    }

    // Check 10s disable exists on message level
    let isMessageLevelDisabled = await rwhSettings.get(`disable.${accountId}.message_${composeDetails.relatedMessageId}`);
    rwhLogger.debug('isMessageLevelDisabled', isMessageLevelDisabled);
    if (isMessageLevelDisabled) {
        return; // RWH stops here
    }

    let fullMsg = await messenger.messages.getFull(composeDetails.relatedMessageId);
    rwhLogger.debug(fullMsg);

    let rwh = new ReplyWithHeader(accountId, composeDetails, fullMsg).init();
    if (!(rwh.isReply || rwh.isForward)) {
        rwhLogger.warn(`Unsupported compose type ${rwh.composeType}`);
        return; // RWH stops here
    }

    await rwh.process(tab);
}

class ReplyWithHeader {
    #accountId
    #composeDetails
    #fullMessage
    #document
    #text

    constructor(accountId, composeDetails, fullMessage) {
        this.#accountId = accountId;
        this.#composeDetails = composeDetails;
        this.#fullMessage = fullMessage;
    }

    // Getters
    get composeType() {
        // reply or forward or draft
        return this.#composeDetails.type;
    }

    get isPlainText() {
        return this.#composeDetails.isPlainText;
    }

    get plainTextBody() {
        return this.#composeDetails.plainTextBody;
    }

    get htmlBody() {
        return this.#composeDetails.body;
    }

    get isReply() {
        return this.composeType === 'reply';
    }

    get isForward() {
        return this.composeType === 'forward';
    }

    get targetNodeClassName() {
        if (this.isReply) {
            return 'moz-cite-prefix'
        } else if (this.isForward) {
            return 'moz-email-headers-table'
        }
        return null;
    }

    // Setters


    // Method

    init() {
        rwhLogger.debug(`composeType=${this.composeType}, messageId=${this.#composeDetails.relatedMessageId}, isPlainText=${this.#composeDetails.isPlainText}`);

        return this;
    }

    async process(tab) {
        let result = { isModified: false };

        if (await rwhSettings.isTransSubjectPrefix()) {
            result.subject = this._transformSubjectPrefix(this.#composeDetails.subject);
        }

        if (this.isPlainText) {
            rwhLogger.debug('Plain Text', this.plainTextBody);
            this.#text = this.plainTextBody;
            result = Object.assign({}, result, await this._processPlainText());
        } else {
            rwhLogger.debug('HTML Content', this.htmlBody);
            this.#document = rwhUtils.createDocumentFromString(this.htmlBody);
            result = Object.assign({}, result, await this._processHtml());
        }

        // Apply it to message compose window
        rwhLogger.debug(result);
        messenger.compose.setComposeDetails(tab.id, result);
    }

    // So called private/internal methods

    async _processHtml() {
        let targetNodeClassName = this.targetNodeClassName;
        let targetNode = this._getByClassName(targetNodeClassName);
        if (!targetNode) {
            rwhLogger.error('Thunderbird email target node (moz-cite-prefix or moz-forward-container) is not found');
            rwhLogger.error('Due to internal changes in Thunderbird. RWH unable to process email headers, contact add-on author');

            // return original value as-is;
            return {
                body: this.#composeDetails.body
            }
        }

        let div = this._createElement('div');
        div.classList.add(targetNodeClassName);

        var headers = {
            'from': await this._extractHeader('from', true, true),
            'to': await this._extractHeader('to', true, true),
            'cc': await this._extractHeader('cc', true, true),
            'date': await this._extractHeader('date', false, true),
            'reply-to': await this._extractHeader('reply-to', true, true),
            'subject': await rwhSettings.isTransSubjectPrefix() ?
				this._transformSubjectPrefix(await this._extractHeader('subject', false, true)) :
				await this._extractHeader('subject', false, true),
        }
        rwhLogger.debug(headers);

        let rwhHeaderString = await this._createHtmlHeaders(headers);
        rwhLogger.debug(rwhHeaderString);

        let rwhHeaderHtmlElement = rwhUtils.createElementFromString(rwhHeaderString);
        div.insertAdjacentElement(positionAfterBegin, rwhHeaderHtmlElement);
        targetNode.replaceWith(div);

        // put back the cleaned up <br> tags as-is
        if (this.isReply) {
			// Originally, there's no <br> after the (unindented) cite prefix.
			// With the table style, it looks better with an extra empty line (like everybody else has it).
            div.insertAdjacentElement(positionBeforeEnd, this._createElement('br'));

            // blockquote
            if (await rwhSettings.isCleanAllBlockQuoteColor()) { // all
                let bqs = this._getAllByTagName('blockquote');
                for (let b of bqs) {
                    b.setAttribute('style', cleanBlockQuoteStyle);
                }
            } else if (await rwhSettings.isCleanBlockQuoteColor()) { // first level
                let bq = this._getByTagName('blockquote');
                bq.setAttribute('style', cleanBlockQuoteStyle);
            }
        }
        if (this.isForward) {
            let mozForwardContainer = this._getByClassName('moz-forward-container');
            this._cleanNodesUpToClassName(mozForwardContainer, targetNodeClassName);

			// Insert 2 <br> before the headers to make it look like a reply does.
			mozForwardContainer.insertAdjacentElement(positionAfterBegin, this._createElement('br'));
			mozForwardContainer.insertAdjacentElement(positionAfterBegin, this._createElement('br'));

			// There are 2 <br> originally, but none for reply mode.
			// We add one for replies, so let's remove one for forwards to make it even.
			let nextBr = mozForwardContainer.querySelector("div.moz-email-headers-table + br");
			nextBr?.remove();
        }

        return {
            body: new XMLSerializer().serializeToString(this.#document),
        }
    }

    async _processPlainText() {
        var headers = {
            'from': await this._extractHeader('from', true, false),
            'to': await this._extractHeader('to', true, false),
            'cc': await this._extractHeader('cc', true, false),
            'date': await this._extractHeader('date', false, false),
            'reply-to': await this._extractHeader('reply-to', true, false),
            'subject': await rwhSettings.isTransSubjectPrefix() ?
				this._transformSubjectPrefix(await this._extractHeader('subject', false, false)) :
				await this._extractHeader('subject', false, false),
        }
        rwhLogger.debug(headers);

        let rwhHeaders = await this._createPlainTextHeaders(headers);
        rwhLogger.debug(rwhHeaders);

        let textLines = this.#text.split(/\r?\n/);
        rwhLogger.debug(textLines);

        let locale = await rwhSettings.getHeaderLocale();
        let startPos = 0;
        let linesToDelete = 1;
        if (this.isReply) {
            let r = this._findPlainTextReplyInsertMarker(textLines, rwhI18n.i18n['wrote'][locale]);
            if (r.found) {
                startPos = r.startPos;
            } else { // fallback
                r = this._findPlainTextReplyInsertMarker(textLines, rwhI18n.i18n['wrote']['en-US']);
                startPos = r.found ? r.startPos : 0;
            }
        } else if (this.isForward) {
            linesToDelete = rwhHeaders.length;
            for (let l of textLines) {
                if (l.trim().startsWith(fwdHdrLookupString)) {
                    break;
                }
                startPos++;
            }
        }

        if (startPos > 0) {
            rwhLogger.debug('startPos', startPos, textLines[startPos]);
            textLines.splice(startPos, linesToDelete, ...rwhHeaders);
        }

        // greater than char '> '
        if (await rwhSettings.isCleanQuoteCharGreaterThan()) {
            for (let i = 0; i < textLines.length; i++) {
                if (textLines[i].startsWith(plainTextFirstChars)) {
                    textLines[i] = textLines[i].replace(plainTextFirstChars, '');
                }
            }
        }


        this.#text = textLines.join('\r\n');
        return {
            plainTextBody: this.#text
        }
    }

    async _createHtmlHeaders(headers) {
        let locale = await rwhSettings.getHeaderLocale();
        let headerLabelSeq = await rwhSettings.getHeaderLabelSeqStyle();
        let headerLabelSeqValues = rwhSettings.headerLabelSeqStyleSettings[headerLabelSeq];

        let rwhHeaders = '<div id="rwhHeaders"';
        if (await rwhSettings.isHeaderHtmlPrefixLine()) {
            let borderColor = await rwhSettings.getHeaderHtmlPrefixLineColor();
            rwhHeaders += ` style="border-top:solid ${borderColor} 1px;padding-top:3px"`
        }
        rwhHeaders += '>';

        headerLabelSeqValues.forEach(function (hdrKey, _) {
            if (hdrKey == 'reply-to' && this.isReply) {
                return;
            }

            let lbl = rwhI18n.i18n[hdrKey][locale]
            if (headerLabelSeq == 1 && hdrKey == 'date') {
                lbl = rwhI18n.i18n['sent'][locale]
            }

            if (headers[hdrKey]) {
                rwhHeaders += '<p style="margin:0"><span><b>' + lbl + '</b> ' + headers[hdrKey] + '</span></p>';
            }
        }, this);

        rwhHeaders += await this._handleAllHeadersFlow(false, true);
        rwhHeaders += '</div>';

        return rwhHeaders;
    }

    async _createPlainTextHeaders(headers) {
        let locale = await rwhSettings.getHeaderLocale();
        let headerLabelSeq = await rwhSettings.getHeaderLabelSeqStyle();
        let headerLabelSeqValues = rwhSettings.headerLabelSeqStyleSettings[headerLabelSeq];

        let rwhHeaders = [];
        if (await rwhSettings.isHeaderPlainPrefixText()) {
            rwhHeaders.push(this.isForward
                ? '-------- ' + rwhI18n.i18n.forwardedMessage[locale] + ' --------'
                : '-------- ' + rwhI18n.i18n.originalMessage[locale] + ' --------');
        } else {
            if (this.isForward) {
                rwhHeaders.push('');
            }
        }

        headerLabelSeqValues.forEach(function (hdrKey, _) {
            if (hdrKey == 'reply-to' && this.isReply) {
                return;
            }

            let lbl = rwhI18n.i18n[hdrKey][locale]
            if (headerLabelSeq == 1 && hdrKey == 'date') {
                lbl = rwhI18n.i18n['sent'][locale]
            }

            if (headers[hdrKey]) {
                rwhHeaders.push(lbl + ' ' + headers[hdrKey]);
            }
        }, this);

        let remainingHeaders = await this._handleAllHeadersFlow(false, false);
        if (remainingHeaders.length > 0) {
            rwhHeaders = [...rwhHeaders, ...remainingHeaders];
        }
        rwhHeaders.push('');

        return rwhHeaders;
    }

    async _parseDate(d) {
        let fallback = (' ' + d).slice(1);
        let locale = await rwhSettings.getHeaderLocale();
        let dateFormat = await rwhSettings.getHeaderDateFormat();
        let timeFormat = await rwhSettings.getHeaderTimeFormat();
        let includeTimezone = await rwhSettings.isHeaderTimeZone();

        rwhLogger.debug('Date format: ' + (dateFormat == 1 ? 'UTC' : 'Locale (' + locale + ')')
            + ', Time format: ' + (timeFormat == 1 ? '24-hour' : (timeFormat == 2 ? 'ISO' : '12-hour'))
            + (includeTimezone ? ', Include short timezone info' : ''))

        let epoch = null;
        try {
            epoch = Date.parse(d);
        } catch (e) {
            rwhLogger.error(error);
            return fallback;
        }

        let pd = new Date(epoch);

        if (timeFormat == 2) {
			// ISO 8601 format
			if (dateFormat == 1) {
				// UTC time zone
				return pd.toISOString().substring(0, 16).replace("T", " ") + " UTC";
			}
			else {
				// Local time zone
				let zone;
				let offsetMins = -pd.getTimezoneOffset();
				if (offsetMins >= 0) {
					zone = "+" +
						Math.trunc(offsetMins / 60).toString().padStart(2, "0") + ":" +
						Math.trunc(offsetMins % 60).toString().padStart(2, "0");
				}
				else {
					offsetMins = -offsetMins;
					zone = "-" +
						Math.trunc(offsetMins / 60).toString().padStart(2, "0") + ":" +
						Math.trunc(offsetMins % 60).toString().padStart(2, "0");
				}
				return pd.getFullYear().toString().padStart(4, "0") + "-" +
					(pd.getMonth() + 1).toString().padStart(2, "0") + "-" +
					pd.getDate().toString().padStart(2, "0") + " " +
					pd.getHours().toString().padStart(2, "0") + ":" +
					pd.getMinutes().toString().padStart(2, "0") + " " +
					zone;
			}
		}

        let options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' };

        if (dateFormat == 1) { // Locale date format
            options.timeZone = 'UTC';
            options.timeZoneName = 'short';
        }

        if (timeFormat == 1) {
            options.hour12 = false;
        } else {
            options.hour12 = true;
        }

        if (includeTimezone) {
            options.timeZoneName = 'short';
        }

        let ds = new Intl.DateTimeFormat(locale, options).format(pd);
        ds = ds.replace(/GMT/, 'UTC');
        return ds;
    }

    async _extractHeader(key, clean, escape) {
        let values = this.#fullMessage.headers[key];
        if (!values) {
            return null;
        }

        if (key === 'date') {
            return this._escapeHtml(await this._parseDate(values[0]));
        }

        let pv = [];
        for (let v of values) {
            pv.push((clean ? this._cleanEmail(v) : v));
        }
        return escape ? this._escapeHtml(pv.join(', ')) : pv.join(', ');
    }

    async _extractRemainingHeaders(clean, escape) {
        let remainingHeaders = {};
        for (let key of Object.keys(this.#fullMessage.headers)) {
            if (rwhSettings.headerLabelSeqStyleSettings[0].includes(key)) { continue; }
            remainingHeaders[key] = await this._extractHeader(key, clean, escape);
        }
        return remainingHeaders;
    }

    _findPlainTextReplyInsertMarker(textLines, lookupWord) {
        let startPos = 0;
        for (let l of textLines) {
            if (l.trim().includes(lookupWord)) {
                return { found: true, startPos: startPos }
            }
            startPos++;
        }
        return { found: false }
    }

    _getByClassName(className) {
        return this.#document?.getElementsByClassName(className)?.[0];
    }

    _getByTagName(tagName) {
        return this._getAllByTagName(tagName)?.[0];
    }

    _getAllByTagName(tagName) {
        return this.#document?.getElementsByTagName(tagName);
    }

    _createElement(tagName) {
        return this.#document?.createElement(tagName);
    }

    _cleanEmail(v) {
        let pv = (v || '').replace(/\\/g, '').replace(/\"/g, '');
        if (pv.startsWith('<')) {
            pv = pv.substring(1, pv.length - 1);
        }
        return pv;
    }

    _escapeHtml(v) {
        return (v || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    _cleanNodesUpToClassName(node, cssClassName) {
        while (node.firstChild) {
            if (node.firstChild?.className?.includes(cssClassName)) {
                break;
            }
            node.removeChild(node.firstChild);
        }
    }

    _transformSubjectPrefix(subject) {
        if (subject.startsWith(rwhSettings.replySubjectPrefix)) {
            return subject.replace(rwhSettings.replySubjectPrefix, 'RE:')
        }
        if (subject.startsWith(rwhSettings.forwardSubjectPrefix)) {
            return subject.replace(rwhSettings.forwardSubjectPrefix, 'FW:');
        }
        return subject;
    }

    async _handleAllHeadersFlow(clean, escape) {
        if (this.isReply) { return ''; }

        let prefName = `header.fwd.all.${this.#accountId}.message_${this.#composeDetails.relatedMessageId}`;
        let isForwardAllHeaders = await rwhSettings.get(prefName);
        rwhLogger.debug('isForwardAllHeaders', isForwardAllHeaders);
        if (isForwardAllHeaders) {
            let remainingHeaders = await this._extractRemainingHeaders(clean, escape);
            rwhLogger.debug(remainingHeaders);

            if (this.isPlainText) {
                let rwhHeaders = [];
                for (let [key, value] of Object.entries(remainingHeaders)) {
                    rwhHeaders.push(rwhUtils.toPartialCanonicalFormat(key) + ': ' + value);
                }
                return rwhHeaders;
            } else {
                let rwhHeaders = '';
                for (let [key, value] of Object.entries(remainingHeaders)) {
                    rwhHeaders += '<p style="margin:0"><span><b>'
                        + rwhUtils.toPartialCanonicalFormat(key) + ':</b> ' + value + '</span></p>';
                }
                return rwhHeaders;
            }
        }

        return '';
    }
}