'use strict';

// The same formatter as the app (KZ-25), served from the built @kazi/shared
// package so the dashboard and the phone show money identically.
import { formatMoney } from '/shared/index.js';

(function () {
  var REFRESH_MS = 15000;

  var state = {
    feedback: [],
    timer: null,
    loading: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value) {
    var n = Number(value || 0);
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function money(value) {
    return formatMoney(Number(value || 0));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    var text = String(value);
    if (text.indexOf(' ') !== -1 && text.indexOf('T') === -1) {
      text = text.replace(' ', 'T') + 'Z';
    }
    var date = new Date(text);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function api(path, options) {
    var opts = options || {};
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-Admin-Request'] = '1';
    }
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: opts.body,
    }).then(function (response) {
      if (response.status === 401) {
        var unauthorized = new Error('unauthorized');
        unauthorized.status = 401;
        throw unauthorized;
      }
      if (!response.ok) {
        return response.json().catch(function () {
          return {};
        }).then(function (data) {
          var error = new Error(data.error || 'Request failed.');
          error.status = response.status;
          throw error;
        });
      }
      return response.json();
    });
  }

  function setStatus(kind, text) {
    var dot = $('status-dot');
    dot.className = 'dot ' + kind;
    $('status-text').textContent = text;
  }

  /* ---------- Views ---------- */

  function showLogin(message) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    $('dashboard-view').hidden = true;
    $('login-view').hidden = false;
    if (message) {
      var error = $('login-error');
      error.textContent = message;
      error.hidden = false;
    }
    $('password').value = '';
  }

  function showDashboard() {
    $('login-view').hidden = true;
    $('dashboard-view').hidden = false;
    $('login-error').hidden = true;
    if (!state.timer) {
      state.timer = setInterval(loadData, REFRESH_MS);
    }
  }

  /* ---------- Rendering ---------- */

  function statCard(label, value, sub, accent) {
    var card = document.createElement('div');
    card.className = 'card stat';
    var l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;
    var v = document.createElement('div');
    v.className = 'value' + (accent ? ' accent' : '');
    v.textContent = value;
    card.appendChild(l);
    card.appendChild(v);
    if (sub) {
      var s = document.createElement('div');
      s.className = 'sub';
      s.textContent = sub;
      card.appendChild(s);
    }
    return card;
  }

  function renderStats(stats) {
    var container = $('stats');
    container.innerHTML = '';
    var net = Number(stats.totalReceived || 0) - Number(stats.totalSpent || 0);
    container.appendChild(statCard('Users', num(stats.users), '+' + num(stats.newUsers7d) + ' this week', true));
    container.appendChild(statCard('New (30d)', num(stats.newUsers30d), 'signups'));
    container.appendChild(statCard('Items', num(stats.items), 'in inventory'));
    container.appendChild(statCard('Transactions', num(stats.transactions), num(stats.sales) + ' sales · ' + num(stats.purchases) + ' expenses'));
    container.appendChild(statCard('Open debts', num(stats.openDebts), num(stats.paidDebts) + ' settled'));
    container.appendChild(statCard('Feedback', num(stats.feedbackCount), 'avg ' + Number(stats.avgRating || 0).toFixed(1) + ' / 5'));
    container.appendChild(statCard('Money in', money(stats.totalReceived), 'from sales'));
    container.appendChild(statCard('Money out', money(stats.totalSpent), 'purchases'));
    container.appendChild(statCard('Capital added', money(stats.totalCapital), 'owner injections'));
    container.appendChild(statCard('Net flow', money(net), 'in minus out', true));
  }

  function renderChart(containerId, axisId, points, accent) {
    var container = $(containerId);
    container.innerHTML = '';
    var max = 1;
    points.forEach(function (point) {
      if (point.value > max) max = point.value;
    });
    points.forEach(function (point) {
      var wrap = document.createElement('div');
      wrap.className = 'bar-wrap';
      var bar = document.createElement('div');
      bar.className = 'bar' + (accent ? ' accent' : '');
      var pct = point.value > 0 ? Math.max((point.value / max) * 100, 4) : 1.5;
      bar.style.height = pct + '%';
      bar.title = point.day + ': ' + num(point.value) + (point.volume ? ' (' + money(point.volume) + ')' : '');
      wrap.appendChild(bar);
      container.appendChild(wrap);
    });
    var axis = $(axisId);
    axis.innerHTML = '';
    if (points.length > 0) {
      var start = document.createElement('span');
      start.textContent = points[0].day;
      var finish = document.createElement('span');
      finish.textContent = points[points.length - 1].day;
      axis.appendChild(start);
      axis.appendChild(finish);
    }
  }

  function stars(rating) {
    var filled = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled);
  }

  function renderFeedback(items) {
    state.feedback = items;
    var list = $('feedback-list');
    list.innerHTML = '';
    var sum = $('feedback-summary');
    if (items.length === 0) {
      sum.textContent = '';
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No feedback yet.';
      list.appendChild(empty);
      return;
    }
    var total = 0;
    items.forEach(function (item) {
      total += Number(item.rating || 0);
    });
    sum.textContent = num(items.length) + ' entries · avg ' + (total / items.length).toFixed(1) + ' / 5';

    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'feedback-card';

      var top = document.createElement('div');
      top.className = 'feedback-top';
      var star = document.createElement('span');
      star.className = 'stars';
      star.textContent = stars(item.rating);
      var who = document.createElement('span');
      who.className = 'name';
      who.textContent = item.userName || 'Unknown';
      var meta = document.createElement('span');
      meta.className = 'feedback-meta';
      meta.textContent = (item.companyName ? item.companyName + ' · ' : '') + formatDateTime(item.createdAt);
      top.appendChild(star);
      top.appendChild(who);
      top.appendChild(meta);
      card.appendChild(top);

      if (item.liked) {
        card.appendChild(feedbackLine('Liked', item.liked));
      }
      if (item.disliked) {
        card.appendChild(feedbackLine('Disliked', item.disliked));
      }
      if (item.suggestion) {
        card.appendChild(feedbackLine('Suggestion', item.suggestion));
      }
      list.appendChild(card);
    });
  }

  function feedbackLine(label, text) {
    var line = document.createElement('p');
    line.className = 'feedback-line';
    var b = document.createElement('b');
    b.textContent = label + ': ';
    line.appendChild(b);
    line.appendChild(document.createTextNode(text));
    return line;
  }

  function tagClass(type) {
    if (type === 'sale') return 'tag sale';
    if (type === 'purchase') return 'tag purchase';
    if (type === 'capital') return 'tag capital';
    return 'tag';
  }

  function renderActivity(items) {
    var wrap = $('activity-table');
    if (items.length === 0) {
      wrap.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No activity recorded yet.';
      wrap.appendChild(empty);
      return;
    }
    var html = '<table><thead><tr><th>When</th><th>Type</th><th>Title</th><th>User</th><th class="nums">Amount</th></tr></thead><tbody>';
    items.forEach(function (item) {
      html += '<tr>';
      html += '<td class="muted">' + esc(formatDateTime(item.createdAt)) + '</td>';
      html += '<td><span class="' + tagClass(item.type) + '">' + esc(item.type) + '</span></td>';
      html += '<td>' + esc(item.title) + (item.quantity ? ' <span class="muted">×' + esc(item.quantity) + '</span>' : '') + '</td>';
      html += '<td>' + esc(item.userName) + (item.companyName ? ' <span class="muted">· ' + esc(item.companyName) + '</span>' : '') + '</td>';
      html += '<td class="nums">' + (item.amount === null || item.amount === undefined ? '—' : money(item.amount)) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function renderUsers(items) {
    var wrap = $('users-table');
    var count = $('users-count');
    if (items.length === 0) {
      count.textContent = '';
      wrap.innerHTML = '';
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No users yet.';
      wrap.appendChild(empty);
      return;
    }
    count.textContent = num(items.length) + ' most recent';
    var html = '<table><thead><tr><th>Name</th><th>Email</th><th>Business</th><th class="nums">Items</th><th class="nums">Txns</th><th class="nums">Debts</th><th>Joined</th><th>Last active</th></tr></thead><tbody>';
    items.forEach(function (user) {
      html += '<tr>';
      html += '<td class="name">' + esc(user.name) + '</td>';
      html += '<td class="muted">' + esc(user.email) + '</td>';
      html += '<td>' + esc(user.companyName || '—') + '<div class="muted">' + esc(user.businessType || '') + '</div></td>';
      html += '<td class="nums">' + num(user.itemCount) + '</td>';
      html += '<td class="nums">' + num(user.transactionCount) + '</td>';
      html += '<td class="nums">' + num(user.debtCount) + '</td>';
      html += '<td class="muted">' + esc(formatDateTime(user.createdAt)) + '</td>';
      html += '<td class="muted">' + esc(user.lastActive ? formatDateTime(user.lastActive) : '—') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function toCsvValue(value) {
    if (value === null || value === undefined) return '';
    var text = String(value).replace(/"/g, '""');
    return '"' + text + '"';
  }

  function downloadFeedbackCsv() {
    var rows = [['Date', 'User', 'Company', 'Rating', 'Liked', 'Disliked', 'Suggestion']];
    state.feedback.forEach(function (item) {
      rows.push([
        item.createdAt,
        item.userName,
        item.companyName || '',
        item.rating,
        item.liked || '',
        item.disliked || '',
        item.suggestion || '',
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(toCsvValue).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'kazi-feedback.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /* ---------- Data loading ---------- */

  function loadData() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    setStatus('stale', 'Refreshing…');
    return Promise.all([
      api('/api/stats'),
      api('/api/series?days=30'),
      api('/api/feedback?limit=200'),
      api('/api/activity?limit=100'),
      api('/api/users?limit=200'),
    ]).then(function (results) {
      renderStats(results[0]);
      renderChart('signups-chart', 'signups-axis', results[1].signups, false);
      renderChart('transactions-chart', 'transactions-axis', results[1].transactions, true);
      renderFeedback(results[2].items || []);
      renderActivity(results[3].items || []);
      renderUsers(results[4].items || []);
      setStatus('', 'Live · ' + new Date().toLocaleTimeString());
    }).catch(function (error) {
      if (error && error.status === 401) {
        showLogin('Your session expired. Sign in again.');
        return;
      }
      setStatus('off', 'Connection problem');
    }).then(function () {
      state.loading = false;
    });
  }

  /* ---------- Events ---------- */

  $('login-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('login-button');
    var error = $('login-error');
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value,
        password: $('password').value,
      }),
    }).then(function () {
      showDashboard();
      return loadData();
    }).catch(function (err) {
      error.textContent = err && err.message ? err.message : 'Sign in failed.';
      error.hidden = false;
    }).then(function () {
      button.disabled = false;
      button.textContent = 'Sign in';
    });
  });

  $('logout-button').addEventListener('click', function () {
    api('/api/logout', { method: 'POST' }).catch(function () {}).then(function () {
      showLogin();
    });
  });

  $('refresh-button').addEventListener('click', function () {
    loadData();
  });

  $('feedback-csv').addEventListener('click', downloadFeedbackCsv);

  /* ---------- Boot ---------- */

  api('/api/session').then(function () {
    showDashboard();
    return loadData();
  }).catch(function () {
    showLogin();
  });
})();
