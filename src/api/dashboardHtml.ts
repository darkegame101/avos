export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AVOS Control Center — Bảng Điều Khiển Quản Trị</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 24px; display: flex; align-items: center; gap: 10px; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-ok { background: rgba(34, 197, 94, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge-stopped { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
    .card-title { font-size: 13px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; font-weight: 600; }
    .card-value { font-size: 28px; font-weight: 700; }
    .token-bar { display: flex; gap: 8px; align-items: center; background: var(--card-bg); padding: 12px 18px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 24px; }
    input[type="text"] { flex: 1; background: #0f172a; border: 1px solid var(--border); padding: 8px 12px; color: #fff; border-radius: 4px; }
    button { cursor: pointer; padding: 8px 16px; border-radius: 4px; font-weight: 600; border: none; transition: 0.15s; }
    .btn-primary { background: var(--primary); color: #0f172a; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-success { background: var(--success); color: #fff; }
    .btn-secondary { background: var(--border); color: #fff; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
    th { color: var(--text-muted); font-weight: 600; }
    .tag { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .tag-gated { background: #451a03; color: #f97316; }
    .tag-safe { background: #064e3b; color: #34d399; }
    .section-title { font-size: 18px; font-weight: 600; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>AVOS Control Center <span id="sys-badge" class="badge badge-ok">Normal</span></h1>
        <p style="color: var(--text-muted); font-size: 14px; margin-top: 4px;">Hệ thống điều hành mạo hiểm tự chủ — ITCertHub & New Ventures</p>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="btn-stop" class="btn-danger" onclick="triggerEmergencyStop()">🚨 Kích hoạt Emergency Stop</button>
        <button id="btn-resume" class="btn-success" style="display:none;" onclick="resumeEmergencyStop()">✅ Hạ Emergency Stop</button>
      </div>
    </header>

    <div class="token-bar">
      <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">Owner Token:</label>
      <input type="text" id="token-input" placeholder="Nhập AVOS_OWNER_TOKEN để thao tác..." />
      <button class="btn-primary" onclick="saveToken()">Lưu Token</button>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">Chi Phí Tháng Này / Hạn Mức</div>
        <div class="card-value" id="spend-val">$0.00 / $50.00</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;" id="spend-rem">Còn lại: $50.00</div>
      </div>
      <div class="card">
        <div class="card-title">Yêu Cầu Chờ Duyệt (Inbox)</div>
        <div class="card-value" style="color: var(--warning);" id="pending-val">0</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Cần chủ sở hữu ký duyệt</div>
      </div>
      <div class="card">
        <div class="card-title">Worker Pool & Queue</div>
        <div class="card-value" style="color: var(--primary);" id="worker-val">0 Jobs</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;" id="worker-concurrency">Concurrency Limit: 5</div>
      </div>
      <div class="card">
        <div class="card-title">Nhiệm Vụ Đã Hoàn Thành</div>
        <div class="card-value" style="color: var(--success);" id="completed-val">0</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;" id="task-total">Tổng nhiệm vụ: 0</div>
      </div>
    </div>

    <!-- Approvals Section -->
    <div class="card" style="margin-bottom: 24px;">
      <div class="section-title">
        <span>Hộp Thư Phê Duyệt Hành Động (Gated Actions Inbox)</span>
        <button class="btn-secondary" style="font-size: 12px;" onclick="loadData()">Làm mới</button>
      </div>
      <div id="approvals-container">
        <table>
          <thead>
            <tr>
              <th>Dự Án</th>
              <th>Hành Động</th>
              <th>Mục Tiêu (Target)</th>
              <th>Dự Toán</th>
              <th>Lý Do</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody id="approvals-table">
            <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Không có yêu cầu chờ duyệt</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Recent Tasks Section -->
    <div class="card" style="margin-bottom: 24px;">
      <div class="section-title">Danh Sách Nhiệm Vụ Gần Đây</div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Dự Án</th>
            <th>Tiêu Đề</th>
            <th>Loại Hành Động</th>
            <th>Trạng Thái</th>
            <th>Chi Phí</th>
          </tr>
        </thead>
        <tbody id="tasks-table">
          <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Đang tải dữ liệu...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Audit Log Section -->
    <div class="card">
      <div class="section-title">Nhật Ký Kiểm Toán (Immutable Audit Trail - SHA-256 Chained)</div>
      <table>
        <thead>
          <tr>
            <th>Thời Gian</th>
            <th>Sự Kiện</th>
            <th>Actor</th>
            <th>Băm Sự Kiện (Event Hash)</th>
          </tr>
        </thead>
        <tbody id="audit-table">
          <tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Đang tải audit logs...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function getToken() {
      return localStorage.getItem('avos_token') || 'test-owner-token-32-chars-long-min';
    }
    function saveToken() {
      const val = document.getElementById('token-input').value.trim();
      if (val) {
        localStorage.setItem('avos_token', val);
        alert('Đã lưu token thành công!');
        loadData();
      }
    }
    document.getElementById('token-input').value = getToken();

    async function apiFetch(endpoint, options = {}) {
      const token = getToken();
      const headers = { ...options.headers, 'Authorization': 'Bearer ' + token };
      const res = await fetch(endpoint, { ...options, headers });
      if (res.status === 401) {
        console.warn('Unauthorized. Vui lòng kiểm tra lại Token.');
      }
      return res;
    }

    async function loadData() {
      try {
        // Health
        const hRes = await fetch('/health');
        if (hRes.ok) {
          const health = await hRes.json();
          const badge = document.getElementById('sys-badge');
          const btnStop = document.getElementById('btn-stop');
          const btnResume = document.getElementById('btn-resume');

          if (health.emergencyStop?.stopped) {
            badge.innerText = 'EMERGENCY STOPPED';
            badge.className = 'badge badge-stopped';
            btnStop.style.display = 'none';
            btnResume.style.display = 'inline-block';
          } else {
            badge.innerText = 'NORMAL';
            badge.className = 'badge badge-ok';
            btnStop.style.display = 'inline-block';
            btnResume.style.display = 'none';
          }
          document.getElementById('worker-val').innerText = (health.worker?.activeJobs || 0) + ' Jobs';
          document.getElementById('worker-concurrency').innerText = 'Concurrency Limit: ' + (health.worker?.concurrencyLimit || 5);
        }

        // Daily Report
        const rRes = await apiFetch('/api/reports/daily');
        if (rRes.ok) {
          const report = await rRes.json();
          document.getElementById('spend-val').innerText = '$' + report.portfolioSpend.totalSpentUsd.toFixed(2) + ' / $' + report.portfolioSpend.monthlyBudgetCapUsd.toFixed(2);
          document.getElementById('spend-rem').innerText = 'Còn lại: $' + report.portfolioSpend.remainingBudgetUsd.toFixed(2);
          document.getElementById('pending-val').innerText = report.taskMetrics.pendingApproval;
          document.getElementById('completed-val').innerText = report.taskMetrics.completed;
          document.getElementById('task-total').innerText = 'Tổng nhiệm vụ: ' + report.taskMetrics.total;

          // Render pending approvals
          const appTable = document.getElementById('approvals-table');
          if (report.pendingApprovals.length === 0) {
            appTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Không có yêu cầu chờ duyệt</td></tr>';
          } else {
            appTable.innerHTML = report.pendingApprovals.map(a => \`
              <tr>
                <td><strong>\${a.projectId}</strong></td>
                <td><span class="tag tag-gated">\${a.actionClass}</span></td>
                <td>\${a.targetResource}</td>
                <td>$\${a.budgetCeilingUsd.toFixed(2)}</td>
                <td>\${a.rationale}</td>
                <td>
                  <button class="btn-success" style="padding: 4px 8px; font-size: 11px;" onclick="approveAction('\${a.id}')">Duyệt</button>
                  <button class="btn-danger" style="padding: 4px 8px; font-size: 11px; margin-left: 4px;" onclick="rejectAction('\${a.id}')">Từ chối</button>
                </td>
              </tr>
            \`).join('');
          }
        }

        // Tasks
        const tRes = await apiFetch('/api/tasks');
        if (tRes.ok) {
          const tasks = await tRes.json();
          const tTable = document.getElementById('tasks-table');
          if (tasks.length === 0) {
            tTable.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Chưa có nhiệm vụ nào</td></tr>';
          } else {
            tTable.innerHTML = tasks.slice(0, 8).map(t => \`
              <tr>
                <td><code>\${t.id.slice(0, 12)}...</code></td>
                <td>\${t.projectId}</td>
                <td>\${t.title}</td>
                <td>\${t.actionClass}</td>
                <td><strong>\${t.status}</strong></td>
                <td>$\${t.actualCostUsd.toFixed(4)}</td>
              </tr>
            \`).join('');
          }
        }

        // Audit Logs
        const aRes = await apiFetch('/api/audit');
        if (aRes.ok) {
          const logs = await aRes.json();
          const aTable = document.getElementById('audit-table');
          if (logs.length === 0) {
            aTable.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Chưa có nhật ký</td></tr>';
          } else {
            aTable.innerHTML = logs.slice(-8).reverse().map(l => \`
              <tr>
                <td>\${new Date(l.createdAt).toLocaleTimeString()}</td>
                <td><strong>\${l.eventType}</strong></td>
                <td>\${l.actor}</td>
                <td><code style="font-size: 11px;">\${l.eventHash.slice(0, 16)}...</code></td>
              </tr>
            \`).join('');
          }
        }
      } catch (err) {
        console.error('Error loading dashboard data:', err);
      }
    }

    async function triggerEmergencyStop() {
      const reason = prompt('Nhập lý do kích hoạt Emergency Stop:');
      if (!reason) return;
      const res = await apiFetch('/api/emergency/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'GLOBAL', reason })
      });
      if (res.ok) {
        alert('Emergency Stop đã được kích hoạt thành công!');
        loadData();
      } else {
        alert('Kích hoạt thất bại. Kiểm tra lại quyền.');
      }
    }

    async function resumeEmergencyStop() {
      const reason = prompt('Nhập lý do hạ Emergency Stop:');
      if (!reason) return;
      const res = await apiFetch('/api/emergency/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'GLOBAL', reason, investigationCompleted: true })
      });
      if (res.ok) {
        alert('Hạ Emergency Stop thành công. Hệ thống đã trở lại hoạt động bình thường.');
        loadData();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + (err.error || 'Không thể hạ stop'));
      }
    }

    async function approveAction(id) {
      if (!confirm('Xác nhận ký duyệt hành động này?')) return;
      const res = await apiFetch(\`/api/approvals/\${id}/approve\`, { method: 'POST' });
      if (res.ok) {
        alert('Đã phê duyệt. Nhiệm vụ đã được xếp vào hàng đợi.');
        loadData();
      }
    }

    async function rejectAction(id) {
      const reason = prompt('Nhập lý do từ chối:');
      if (!reason) return;
      const res = await apiFetch(\`/api/approvals/\${id}/reject\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      if (res.ok) {
        alert('Đã từ chối hành động.');
        loadData();
      }
    }

    // Auto-refresh every 5 seconds
    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`;
}
