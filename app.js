(function () {
  'use strict';

  var KEYS = {
    data: 'scriptRehearsal.data',
    me: 'scriptRehearsal.me',
    mode: 'scriptRehearsal.mode',
    section: 'scriptRehearsal.section',
    onlyMine: 'scriptRehearsal.onlyMine',
    rawText: 'scriptRehearsal.rawText',
    rawJson: 'scriptRehearsal.rawJson',
    inputMethod: 'scriptRehearsal.inputMethod'
  };

  var state = {
    data: null,
    me: [],
    mode: 'full',
    section: 'all',
    onlyMine: false,
    rawText: '',
    rawJson: '',
    inputMethod: 'text'
  };

  var el = {};

  // ================= Persistence =================

  function loadState() {
    try {
      var rawData = localStorage.getItem(KEYS.data);
      state.data = rawData ? JSON.parse(rawData) : null;
    } catch (e) { state.data = null; }
    try {
      var rawMe = localStorage.getItem(KEYS.me);
      state.me = rawMe ? JSON.parse(rawMe) : [];
    } catch (e) { state.me = []; }
    state.mode = localStorage.getItem(KEYS.mode) || 'full';
    state.section = localStorage.getItem(KEYS.section) || 'all';
    state.onlyMine = localStorage.getItem(KEYS.onlyMine) === '1';
    state.rawText = localStorage.getItem(KEYS.rawText) || '';
    state.rawJson = localStorage.getItem(KEYS.rawJson) || '';
    state.inputMethod = localStorage.getItem(KEYS.inputMethod) || 'text';
  }

  function saveData() { localStorage.setItem(KEYS.data, JSON.stringify(state.data)); }
  function saveMe() { localStorage.setItem(KEYS.me, JSON.stringify(state.me)); }
  function saveMode() { localStorage.setItem(KEYS.mode, state.mode); }
  function saveSection() { localStorage.setItem(KEYS.section, String(state.section)); }
  function saveOnlyMine() { localStorage.setItem(KEYS.onlyMine, state.onlyMine ? '1' : '0'); }
  function saveRawText() { localStorage.setItem(KEYS.rawText, state.rawText); }
  function saveRawJson() { localStorage.setItem(KEYS.rawJson, state.rawJson); }
  function saveInputMethod() { localStorage.setItem(KEYS.inputMethod, state.inputMethod); }

  // ================= Utilities =================

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function splitSentences(paragraph) {
    var parts = paragraph.match(/[^。！？.!?]+[。！？.!?]?/g);
    if (!parts) return [paragraph];
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function getCue(sentence) {
    var hasLatinWords = /[a-zA-Z]/.test(sentence) && /\s/.test(sentence);
    if (hasLatinWords) {
      var words = sentence.split(/\s+/);
      var n = Math.max(2, Math.ceil(words.length * 0.3));
      return words.slice(0, n).join(' ') + ' …';
    }
    var count = Math.max(3, Math.ceil(sentence.length * 0.25));
    return sentence.slice(0, count) + '…';
  }

  function getHiddenPlaceholder(sentence) {
    var dots = Math.max(1, Math.ceil(sentence.length / 4));
    var arr = [];
    for (var i = 0; i < dots; i++) arr.push('●');
    return arr.join(' ');
  }

  function isMine(speaker) {
    return state.me.indexOf(speaker) !== -1;
  }

  function copyText(text, onDone) {
    function legacyCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      onDone(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }, legacyCopy);
    } else {
      legacyCopy();
    }
  }

  // ================= Text parser =================
  // 语法：
  //   # 标题        -> 开启新分节
  //   角色名：内容   -> 开启该角色的新片段（全角/半角冒号均可）
  //   其他行         -> 续接上一个片段的文本

  function parseText(raw) {
    var lines = raw.split(/\r?\n/);
    var roles = [];
    var sections = [];
    var currentSection = null;
    var currentSegment = null;

    function ensureSection() {
      if (!currentSection) {
        currentSection = { title: '第一部分', segments: [] };
        sections.push(currentSection);
      }
    }
    function addRole(name) {
      if (roles.indexOf(name) === -1) roles.push(name);
    }

    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) return;

      if (line.charAt(0) === '#') {
        var title = line.slice(1).trim() || ('第' + (sections.length + 1) + '部分');
        currentSection = { title: title, segments: [] };
        sections.push(currentSection);
        currentSegment = null;
        return;
      }

      var m = line.match(/^([^\s:：]{1,20})[:：]\s*(.*)$/);
      if (m && m[2]) {
        ensureSection();
        var speaker = m[1].trim();
        addRole(speaker);
        currentSegment = { speaker: speaker, text: m[2].trim() };
        currentSection.segments.push(currentSegment);
        return;
      }

      ensureSection();
      if (!currentSegment) {
        var fallbackSpeaker = roles[0] || '未命名角色';
        addRole(fallbackSpeaker);
        currentSegment = { speaker: fallbackSpeaker, text: line };
        currentSection.segments.push(currentSegment);
      } else {
        currentSegment.text = (currentSegment.text + ' ' + line).trim();
      }
    });

    return { roles: roles, sections: sections.filter(function (s) { return s.segments.length; }) };
  }

  // ================= JSON validation =================

  function validateJson(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'JSON 根节点必须是一个对象' };
    if (!Array.isArray(obj.roles)) return { ok: false, error: '缺少 roles 数组' };
    if (!Array.isArray(obj.sections) || !obj.sections.length) {
      return { ok: false, error: '缺少 sections 数组，或者是空数组' };
    }
    for (var i = 0; i < obj.sections.length; i++) {
      var sec = obj.sections[i];
      if (!sec || typeof sec.title !== 'string' || !sec.title.trim()) {
        return { ok: false, error: '第 ' + (i + 1) + ' 个分节缺少 title 字段' };
      }
      if (!Array.isArray(sec.segments) || !sec.segments.length) {
        return { ok: false, error: '第 ' + (i + 1) + ' 个分节（' + sec.title + '）缺少 segments 数组，或者是空数组' };
      }
      for (var j = 0; j < sec.segments.length; j++) {
        var seg = sec.segments[j];
        if (!seg || typeof seg.speaker !== 'string' || !seg.speaker.trim()) {
          return { ok: false, error: '第 ' + (i + 1) + ' 个分节的第 ' + (j + 1) + ' 条片段缺少 speaker 字段' };
        }
        if (typeof seg.text !== 'string' || !seg.text.trim()) {
          return { ok: false, error: '第 ' + (i + 1) + ' 个分节的第 ' + (j + 1) + ' 条片段缺少 text 字段' };
        }
      }
    }
    if (obj.me !== undefined && !Array.isArray(obj.me)) {
      return { ok: false, error: 'me 字段如果存在，必须是数组' };
    }

    var roleSet = {};
    obj.roles.forEach(function (r) { roleSet[r] = true; });
    obj.sections.forEach(function (sec) {
      sec.segments.forEach(function (seg) {
        if (!roleSet[seg.speaker]) { roleSet[seg.speaker] = true; obj.roles.push(seg.speaker); }
      });
    });

    return { ok: true, data: { roles: obj.roles, sections: obj.sections }, me: obj.me };
  }

  // ================= Rendering: practice view =================

  function getVisibleSections() {
    if (!state.data) return [];
    if (state.section === 'all') return state.data.sections;
    var idx = Number(state.section);
    var sec = state.data.sections[idx];
    return sec ? [sec] : state.data.sections;
  }

  function applySentenceMode(span, sentence, mode) {
    span.classList.remove('peeked');
    if (mode === 'cue') {
      span.textContent = getCue(sentence);
      span.classList.add('maskable');
    } else {
      span.textContent = getHiddenPlaceholder(sentence);
      span.classList.add('maskable');
    }
  }

  function toggleSentencePeek(span, sentence) {
    if (span.classList.contains('peeked')) {
      span.classList.remove('peeked');
      applySentenceMode(span, sentence, state.mode);
    } else {
      span.textContent = sentence;
      span.classList.add('peeked');
    }
  }

  function renderSegment(seg) {
    var mine = isMine(seg.speaker);
    var block = document.createElement('div');
    block.className = 'segment ' + (mine ? 'segment-mine' : 'segment-other');
    if (mine) block.dataset.mine = '1';

    var label = document.createElement('div');
    label.className = 'speaker-label';
    label.textContent = seg.speaker;
    block.appendChild(label);

    var body = document.createElement('div');
    body.className = 'segment-body';

    if (!mine || state.mode === 'full') {
      body.textContent = seg.text;
    } else {
      splitSentences(seg.text).forEach(function (sentence) {
        var span = document.createElement('span');
        span.className = 'sentence';
        applySentenceMode(span, sentence, state.mode);
        span.addEventListener('click', function () { toggleSentencePeek(span, sentence); });
        body.appendChild(span);
        body.appendChild(document.createTextNode(' '));
      });
    }

    block.appendChild(body);
    return block;
  }

  function renderPractice() {
    el.content.innerHTML = '';
    var sections = getVisibleSections();
    var anyRendered = false;

    sections.forEach(function (sec) {
      var segs = sec.segments.filter(function (seg) {
        return !state.onlyMine || isMine(seg.speaker);
      });
      if (!segs.length) return;
      anyRendered = true;

      if (state.section === 'all') {
        var h = document.createElement('h2');
        h.className = 'section-title';
        h.textContent = sec.title;
        el.content.appendChild(h);
      }

      segs.forEach(function (seg) {
        el.content.appendChild(renderSegment(seg));
      });
    });

    if (!anyRendered) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = state.onlyMine
        ? '这里没有属于你的片段，检查一下设置里选对角色了吗？'
        : '还没有内容。';
      el.content.appendChild(empty);
    }

    renderRoleChips();
    renderSectionTabs();
    updateMePrompt();
    updateJumpButtonVisibility();
  }

  function renderRoleChips() {
    el.roleChips.innerHTML = '';
    if (!state.data) return;
    state.data.roles.forEach(function (role) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'role-chip' + (isMine(role) ? ' selected' : '');
      chip.textContent = role;
      chip.addEventListener('click', function () {
        var idx = state.me.indexOf(role);
        if (idx === -1) state.me.push(role); else state.me.splice(idx, 1);
        saveMe();
        renderPractice();
      });
      el.roleChips.appendChild(chip);
    });
  }

  function makeSegmentedTab(label, value, currentValue, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'segmented-btn' + (String(currentValue) === String(value) ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', function () { onClick(value); });
    return btn;
  }

  function renderSectionTabs() {
    el.sectionTabs.innerHTML = '';
    if (!state.data) return;
    el.sectionTabs.appendChild(makeSegmentedTab('全部', 'all', state.section, selectSection));
    state.data.sections.forEach(function (sec, i) {
      el.sectionTabs.appendChild(makeSegmentedTab(sec.title, i, state.section, selectSection));
    });
  }

  function selectSection(value) {
    state.section = String(value);
    saveSection();
    renderPractice();
  }

  function updateMePrompt() {
    var show = state.me.length === 0 && !!state.data && state.data.roles.length > 0;
    el.mePrompt.classList.toggle('hidden', !show);
  }

  function updateJumpButtonVisibility() {
    var show = state.me.length > 0 && !state.onlyMine;
    el.jumpBtn.classList.toggle('hidden', !show);
  }

  function jumpToNextMine() {
    var mineEls = Array.prototype.slice.call(el.content.querySelectorAll('[data-mine="1"]'));
    if (!mineEls.length) return;
    var threshold = window.scrollY + window.innerHeight * 0.4;
    var target = null;
    for (var i = 0; i < mineEls.length; i++) {
      if (mineEls[i].getBoundingClientRect().top + window.scrollY > threshold) {
        target = mineEls[i];
        break;
      }
    }
    if (!target) target = mineEls[0];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updateModeButtons() {
    el.modeButtons.forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
  }

  // ================= View switching =================

  function showPractice() {
    el.editView.classList.add('hidden');
    el.practiceView.classList.remove('hidden');
    el.onlyMineToggle.checked = state.onlyMine;
    updateModeButtons();
    renderPractice();
  }

  function showEdit() {
    el.practiceView.classList.add('hidden');
    el.editView.classList.remove('hidden');
    el.settingsPanel.classList.remove('open');
    el.settingsBackdrop.classList.remove('open');
    el.textInput.value = state.rawText;
    el.jsonInput.value = state.rawJson;
    switchInputTab(state.inputMethod);
  }

  function switchInputTab(tab) {
    state.inputMethod = tab;
    saveInputMethod();
    el.inputTabButtons.forEach(function (b) {
      b.classList.toggle('active', b.dataset.inputTab === tab);
    });
    el.textPane.classList.toggle('hidden', tab !== 'text');
    el.jsonPane.classList.toggle('hidden', tab !== 'json');
  }

  function showTextError(msg) {
    el.textError.textContent = msg || '';
    el.textError.classList.toggle('hidden', !msg);
  }

  function showJsonError(msg) {
    el.jsonError.textContent = msg || '';
    el.jsonError.classList.toggle('hidden', !msg);
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.toast.classList.remove('show'); }, 2000);
  }

  function applyNewData(data, meFromJson) {
    state.data = data;
    state.section = 'all';
    state.onlyMine = false;

    if (meFromJson && meFromJson.length) {
      state.me = meFromJson.filter(function (r) { return data.roles.indexOf(r) !== -1; });
    } else {
      state.me = (state.me || []).filter(function (r) { return data.roles.indexOf(r) !== -1; });
    }

    saveData();
    saveMe();
    saveSection();
    saveOnlyMine();
    showPractice();
  }

  // ================= Event binding =================

  function cacheEls() {
    el.editView = document.getElementById('editView');
    el.practiceView = document.getElementById('practiceView');

    el.inputTabButtons = Array.prototype.slice.call(document.querySelectorAll('.input-tab-btn'));
    el.textPane = document.getElementById('textPane');
    el.jsonPane = document.getElementById('jsonPane');

    el.textInput = document.getElementById('textInput');
    el.startTextBtn = document.getElementById('startTextBtn');
    el.textError = document.getElementById('textError');

    el.jsonInput = document.getElementById('jsonInput');
    el.jsonFile = document.getElementById('jsonFile');
    el.startJsonBtn = document.getElementById('startJsonBtn');
    el.copySchemaBtn = document.getElementById('copySchemaBtn');
    el.jsonError = document.getElementById('jsonError');

    el.sectionTabs = document.getElementById('sectionTabs');
    el.modeButtons = Array.prototype.slice.call(document.querySelectorAll('.mode-btn'));
    el.onlyMineToggle = document.getElementById('onlyMineToggle');
    el.settingsBtn = document.getElementById('settingsBtn');
    el.settingsPanel = document.getElementById('settingsPanel');
    el.settingsBackdrop = document.getElementById('settingsBackdrop');
    el.settingsCloseBtn = document.getElementById('settingsCloseBtn');
    el.roleChips = document.getElementById('roleChips');
    el.editBtn = document.getElementById('editBtn');
    el.exportBtn = document.getElementById('exportBtn');

    el.mePrompt = document.getElementById('mePrompt');
    el.content = document.getElementById('content');
    el.jumpBtn = document.getElementById('jumpBtn');
    el.toast = document.getElementById('toast');
  }

  function bindEvents() {
    el.inputTabButtons.forEach(function (btn) {
      btn.addEventListener('click', function () { switchInputTab(btn.dataset.inputTab); });
    });

    el.startTextBtn.addEventListener('click', function () {
      var raw = el.textInput.value;
      var parsed = parseText(raw);
      if (!parsed.sections.length) {
        showTextError('还没有内容，至少要写一句台词，比如"角色名：内容"');
        return;
      }
      showTextError('');
      state.rawText = raw;
      saveRawText();
      applyNewData(parsed, null);
    });

    el.textInput.addEventListener('input', debounce(function () {
      state.rawText = el.textInput.value;
      saveRawText();
    }, 400));

    el.startJsonBtn.addEventListener('click', function () {
      var raw = el.jsonInput.value.trim();
      if (!raw) { showJsonError('先粘贴 JSON，或者点"选择文件"导入'); return; }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        showJsonError('JSON 解析失败：' + e.message);
        return;
      }
      var result = validateJson(parsed);
      if (!result.ok) { showJsonError(result.error); return; }
      showJsonError('');
      state.rawJson = raw;
      saveRawJson();
      applyNewData(result.data, result.me);
    });

    el.jsonInput.addEventListener('input', debounce(function () {
      state.rawJson = el.jsonInput.value;
      saveRawJson();
    }, 400));

    el.jsonFile.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        el.jsonInput.value = reader.result;
        state.rawJson = reader.result;
        saveRawJson();
      };
      reader.readAsText(file);
      el.jsonFile.value = '';
    });

    el.copySchemaBtn.addEventListener('click', function () {
      var example = JSON.stringify({
        roles: ['张三', '李四', '我'],
        me: ['我'],
        sections: [{
          title: '第一部分',
          segments: [
            { speaker: '张三', text: '示例台词……' },
            { speaker: '我', text: '示例台词……' }
          ]
        }]
      }, null, 2);
      var instructions = '请把下面这段内容转换成这个 JSON 格式：roles 是出现的角色名数组；me 是可选字段，写你自己扮演的角色名数组（可以有多个）；sections 是按顺序排列的分节数组，每个分节有 title 和 segments，每个 segment 有 speaker（发言人）和 text（台词内容）。\n\n格式示例：\n' + example + '\n\n请把我接下来发的内容按这个格式转换成 JSON，只输出 JSON。';
      copyText(instructions, function (ok) {
        showToast(ok ? '已复制格式说明到剪贴板' : '复制失败，请手动选择文本复制');
      });
    });

    el.modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.mode = btn.dataset.mode;
        saveMode();
        updateModeButtons();
        renderPractice();
      });
    });

    el.onlyMineToggle.addEventListener('change', function () {
      state.onlyMine = el.onlyMineToggle.checked;
      saveOnlyMine();
      renderPractice();
    });

    el.settingsBtn.addEventListener('click', function () {
      el.settingsPanel.classList.add('open');
      el.settingsBackdrop.classList.add('open');
    });
    function closeSettings() {
      el.settingsPanel.classList.remove('open');
      el.settingsBackdrop.classList.remove('open');
    }
    el.settingsCloseBtn.addEventListener('click', closeSettings);
    el.settingsBackdrop.addEventListener('click', closeSettings);

    el.editBtn.addEventListener('click', function () {
      closeSettings();
      showEdit();
    });

    el.exportBtn.addEventListener('click', function () {
      if (!state.data) return;
      var blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'script.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    el.jumpBtn.addEventListener('click', jumpToNextMine);
  }

  // 首次使用（本地还没有任何稿子）时，尝试读取项目文件夹里的 default.json 当默认稿子。
  // 只有通过 http(s) 访问时 fetch 才能读到本地文件；用 file:// 双击打开会请求失败，
  // 这时安静地回退到空白录入页，不影响正常使用。
  function loadDefaultData() {
    return fetch('default.json')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json) return null;
        var result = validateJson(json);
        return result.ok ? result : null;
      })
      .catch(function () { return null; });
  }

  function init() {
    cacheEls();
    loadState();
    bindEvents();
    if (state.data && state.data.sections && state.data.sections.length) {
      showPractice();
      return;
    }
    loadDefaultData().then(function (result) {
      if (result) {
        applyNewData(result.data, result.me);
      } else {
        showEdit();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
