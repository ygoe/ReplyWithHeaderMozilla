'use strict';

/*
 * Copyright (c) 2015-2016 Jeevanandam M. (jeeva@myjeeva.com)
 *
 * This Source Code is subject to terms of MIT License.
 * Please refer to LICENSE.txt in the root folder of RWH extension.
 * You can download a copy of license at https://github.com/jeevatkm/ReplyWithHeaderMozilla/blob/master/LICENSE.txt
 */

/* globals ReplyWithHeader */

Components.utils.import('resource://gre/modules/XPCOMUtils.jsm');

ReplyWithHeader.Prefs = {
  getIntPref: function(p) {
    return this.branch.getIntPref('extensions.replywithheader.' + p);
  },

  getBoolPref: function(p) {
    return this.branch.getBoolPref('extensions.replywithheader.' + p);
  },

  getStringPref: function(p) {
    return this.branch.getCharPref('extensions.replywithheader.' + p);
  },

  get isEnabled() {
    return this.getBoolPref('enable');
  },

  get isDebugEnabled() {
    return this.getBoolPref('debug');
  },

  get fromLabelStyle() {
    return this.getIntPref('header.from.style');
  },

  get toccLabelStyle() {
    return this.getIntPref('header.tocc.style');
  },

  get beforeSepSpaceCnt() {
    return this.getIntPref('header.separator.space.before');
  },

  get beforeHdrSpaceCnt() {
    return this.getIntPref('header.space.before');
  },

  get afterHdrSpaceCnt() {
    return this.getIntPref('header.space.after');
  },

  get dateFormat() {
    return this.getIntPref('header.date.format');
  },

  get headerFontFace() {
    return this.getStringPref('header.font.face');
  },

  get headerFontSize() {
    return this.getIntPref('header.font.size');
  },

  get headerFontColor() {
    return this.getStringPref('header.font.color');
  },

  get headerQuotLblSeq() {
    return this.getIntPref('header.lblseq.style');
  },

  get isSubjectPrefixEnabled() {
    return this.getBoolPref('trans.subject.prefix');
  },

  get cleanBlockQuote() {
    return this.getBoolPref('clean.blockquote');
  },

  get cleanNewBlockQuote() {
    return this.getBoolPref('clean.new.blockquote');
  },

  get cleanGreaterThanChar() {
    return this.getBoolPref('clean.char.greaterthan');
  },

  get excludePlainTxtHdrPrefix() {
    return this.getBoolPref('clean.pln.hdr.prefix');
  },

  openWebsite: function() {
    ReplyWithHeader.openUrl(ReplyWithHeader.homepageUrl);
  },

  openReviews: function() {
    ReplyWithHeader.openUrl(ReplyWithHeader.reviewsPageUrl);
  },

  reportIssues: function() {
    ReplyWithHeader.openUrl(ReplyWithHeader.issuesPageUrl);
  },

  openPaypal: function() {
    ReplyWithHeader.showAlert('Opening PayPal Service. Thanks for supporting ReplyWithHeader.');
    ReplyWithHeader.openUrl(ReplyWithHeader.paypalDonateUrl);
  },

  copyBtcAddress: function() {
    this.copyToClipboard(ReplyWithHeader.btcAddress);
    ReplyWithHeader.showAlert('BTC address is copied. Thanks for supporting ReplyWithHeader.');
  },

  copyToClipboard: function(str) {
    if (str) {
      this.clipboard.copyString(str);
    }
  },

  fixCursorBlink: function() {
    // Ref: Due this Bug 567240 - Cursor does not blink when replying
    // (https://bugzilla.mozilla.org/show_bug.cgi?id=567240)
    // RWH is setting this 'mail.compose.max_recycled_windows' value to 0
    let maxRecycledWindows = this.branch.getIntPref('mail.compose.max_recycled_windows');
    if (maxRecycledWindows == 1) {
      this.branch.setIntPref('mail.compose.max_recycled_windows', 0);
    }
  },

  createMenuItem: function(v, l) {
    var menuItem = document.createElement('menuitem');
    menuItem.setAttribute('value', v);
    menuItem.setAttribute('label', l);
    return menuItem;
  },

  loadFontFaces: function() {
    let allFonts = Components.classes['@mozilla.org/gfx/fontenumerator;1']
      .createInstance(Components.interfaces.nsIFontEnumerator).EnumerateAllFonts({});

    let hdrFontface = this.headerFontFace;
    let menuPopup = document.createElement('menupopup');
    let selectedIdx = 0;

    for (let fontCount = allFonts.length, i = 0; i < fontCount; i++) {
      if (allFonts[i] == hdrFontface) {
        selectedIdx = i;
      }
      menuPopup.appendChild(this.createMenuItem(allFonts[i], allFonts[i]));
    }

    let hdrFontfaceObj = ReplyWithHeader.byId('hdrFontface');
    hdrFontfaceObj.appendChild(menuPopup);
    hdrFontfaceObj.selectedIndex = selectedIdx;
  },

  loadFontSizes: function() {
    let hdrFontsize = this.headerFontSize;
    let menuPopup = document.createElement('menupopup');
    let selectedIdx = 0;

    for (let i = 10, j = 0; i < 35; i++, j++) {
      if (i == hdrFontsize) {
        selectedIdx = j;
      }
      menuPopup.appendChild(this.createMenuItem(i, i + 'px'));
    }

    let hdrFontsizeObj = ReplyWithHeader.byId('hdrFontsize');
    hdrFontsizeObj.appendChild(menuPopup);
    hdrFontsizeObj.selectedIndex = selectedIdx;
  },

  init: function() {
    this.toggleRwh();

    // Assigning values
    ReplyWithHeader.byId('abtRwhCaption').value = 'ReplyWithHeader v' + ReplyWithHeader.addonVersion;

    this.loadFontFaces();

    this.loadFontSizes();

    this.toggleBlockQuote();

    this.forPostbox(true);
  },

  toggleRwh: function() {
    let rwh = ReplyWithHeader.byId('enableRwh');
    var ids = ['lblFromAttribution', 'fromAttributionStyle', 'lblHeaderToCcAttrib', 'toccAttributionStyle',
      'lblHdrDate', 'quotDateAttributionStyle', 'lblTypography', 'lblFontface', 'hdrFontface', 'lblFontsize',
      'hdrFontsize', 'lblFontcolor', 'hdrFontColor', 'lblSpace', 'lblBeforeHeader', 'spaceBeforeHdr',
      'lblAfterHeader', 'spaceAfterHdr', 'lblBeforeSeparator', 'spaceBeforeSep', 'lblHeaderQuotSeq',
      'quotSeqAttributionStyle', 'transSubjectPrefix', 'lblNotAppBeforeSeparator', 'lblCntFormat',
      'cleanBlockQuote', 'cleanNewBlockQuote', 'cleanGreaterThanChar', 'lblHeaderFormat',
      'excludePlainTextHdrPrefix', 'enableRwhDebugMode'
    ];

    for (let len = ids.length, i = 0; i < len; i++) {
      this.toggle(ids[i], !rwh.checked);
    }

    this.forPostbox(true);
  },

  toggle: function(id, v) {
    ReplyWithHeader.byId(id).disabled = v;
  },

  forPostbox: function(v) {
    if (ReplyWithHeader.isPostbox) {
      this.toggle('lblBeforeSeparator', v);
      this.toggle('spaceBeforeSep', v);
      this.toggle('lblNotAppBeforeSeparator', v);
    }
  },

  toggleBlockQuote: function() {
    let cbq = ReplyWithHeader.byId('cleanBlockQuote');
    this.toggle('cleanNewBlockQuote', !cbq.checked);
  }
};

// Initializing Services
XPCOMUtils.defineLazyServiceGetter(ReplyWithHeader.Prefs, 'branch',
                                   '@mozilla.org/preferences-service;1',
                                   'nsIPrefBranch');

XPCOMUtils.defineLazyServiceGetter(ReplyWithHeader.Prefs, 'clipboard',
                                  '@mozilla.org/widget/clipboardhelper;1',
                                  'nsIClipboardHelper');
