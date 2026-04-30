// ==UserScript==
// @name        Luisa Score Helper
// @namespace   https://github.com/soudblox/luisa-helper
// @match       https://www.luisa.id/ulangan_harian
// @version     1.0.0
// @author      -
// @description Menampilkan rata-rata nilai, statistik mapel, nilai terbaru, dan detail penilaian di halaman Ulangan Harian luisa.id
// @license     MIT
// @run-at      document-start
// @grant       GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // styling popup etc
    GM_addStyle(`
        .luisa-modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); z-index: 999;
            display: flex; justify-content: center; align-items: center;
            opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
        }
        .luisa-modal-overlay.visible { opacity: 1; pointer-events: auto; }
        .luisa-modal-container {
            background: #fff; border-radius: 15px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            max-width: 500px; width: 90%; max-height: 80%; overflow: hidden;
            transform: scale(0.7); opacity: 0; transition: all 0.3s ease;
            position: relative; padding: 25px;
        }
        .luisa-modal-content {
            max-height: calc(80vh - 90px); overflow-y: auto;
        }
        .luisa-modal-overlay.visible .luisa-modal-container { transform: scale(1); opacity: 1; }
        .luisa-modal-overlay[data-modal-id="stats"] .luisa-modal-container {
            max-width: 620px; max-height: 85vh; padding: 24px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.2); border-radius: 16px;
        }
        .luisa-modal-overlay[data-modal-id="stats"] .luisa-modal-content {
            max-height: calc(85vh - 80px);
        }
        .luisa-modal-close {
            position: absolute; top: 10px; right: 10px;
            background: #f44336; color: #fff; border: none;
            border-radius: 50%; width: 35px; height: 35px; font-size: 20px;
            display: flex; justify-content: center; align-items: center;
            cursor: pointer; transition: background-color 0.2s;
        }
        .luisa-modal-close:hover { background: #d32f2f; }
        .luisa-popup-header { color: #333; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; }
        .luisa-popup-box { background: #f9f9f9; padding: 15px; border-radius: 10px; }
        .luisa-popup-box ul { list-style-type: none; padding: 0; }
        .luisa-clickable { text-decoration: underline; cursor: pointer; }
        #total-average-display { text-align: right; font-weight: bold; margin-bottom: 10px; font-size: 16px; }
        #overall-average-controls { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
        #overall-actions-group { display: flex; gap: 8px; flex-wrap: wrap; }
        #subject-average-wrapper { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 10px; }
        #subject-average-result { font-weight: bold; flex: 1; text-align: right; }
        .stats-card { padding: 16px; border-radius: 12px; }
        .stats-card-high { background: #f7f9fc; }
        .stats-card-low { background: #fdf4f6; }
        .stats-card h3 { margin-top: 0; font-size: 16px; }
        .stats-card-high h3 { color: #6c63ff; }
        .stats-card-low h3 { color: #ff6584; }
        .stats-card .score { margin: 4px 0 0; font-size: 24px; font-weight: 700; }
        .stats-card .name { margin: 0; color: #555; }
        .stats-card small { color: #888; }
        .stats-table { width: 100%; border-collapse: collapse; }
        .stats-table thead tr { background: #f2f4f7; }
        .stats-table th, .stats-table td { text-align: left; padding: 8px; }
        #overall-actions-group button:disabled,
        #subject-average-button:disabled {
            opacity: 0.5; cursor: not-allowed;
        }
        .recent-score-item {
            display: flex; justify-content: space-between; align-items: center;
            padding: 10px 12px; border-bottom: 1px solid #f0f0f0;
            transition: background 0.15s;
        }
        .recent-score-item:hover { background: #f9f9fb; }
        .recent-score-item:last-child { border-bottom: none; }
        .recent-score-left { flex: 1; min-width: 0; }
        .recent-score-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .recent-score-subject { font-size: 12px; color: #888; margin-top: 2px; }
        .recent-score-right { text-align: right; flex-shrink: 0; margin-left: 12px; }
        .recent-score-value { font-size: 20px; font-weight: 700; }
        .recent-score-date { font-size: 11px; color: #aaa; margin-top: 2px; }
        .recent-score-badge {
            display: inline-block; font-size: 10px; padding: 2px 6px;
            border-radius: 4px; background: #eef0f5; color: #555; margin-top: 3px;
        }
    `);

    let NIS = '';
    const JENIS_TUGAS = {
        8: "Tes",
        9: "Presentasi",
        10: "Tugas",
        11: "Praktik",
        13: "Produk"
    };

    // Subjects excluded from average calculations (loose match — contains check)
    const EXCLUDED_SUBJECTS = ['bimbingan konseling'];
    const isExcludedSubject = (name) => EXCLUDED_SUBJECTS.some(ex => name.toLowerCase().includes(ex));

    let subjectListCache = [];
    let latestSubjectDetail = [];
    let latestSubjectName = '';
    const subjectDetailCache = new Map();
    const subjectDetailPromises = new Map();
    let cachedOverallAverage = null;
    let cachedSubjectAverages = null;



    const formatScore = (value) => {
        const number = Number(value);
        if (Number.isNaN(number)) return 'Tidak ada data';
        return number.toFixed(2);
    };

    const openSubjectDetailById = async (subjectId) => {
        if (!subjectId) return;
        const subjects = await ensureSubjectList();
        const index = subjects.findIndex(({ id }) => id === subjectId);
        if (index === -1) {
            console.warn('Mapel tidak ditemukan dalam daftar.');
            return;
        }
        const detailButtons = [...document.querySelectorAll('button.btn.btn-primary')]
            .filter(btn => btn.textContent.includes('Detail'));
        const targetButton = detailButtons[index];
        if (targetButton) {
            targetButton.click();
        } else {
            console.warn('Tombol detail mapel tidak ditemukan.');
        }
    };

    const attachStatsLinkHandlers = () => {
        const links = document.querySelectorAll('.stats-subject-link');
        links.forEach((link) => {
            if (link.dataset.bound === 'true') return;
            link.dataset.bound = 'true';
            link.addEventListener('click', async (event) => {
                event.preventDefault();
                const subjectId = Number(event.currentTarget.dataset.subjectId);
                if (!subjectId) return;
                Modal.hide('stats');
                await openSubjectDetailById(subjectId);
            });
        });
    };

    const TEXT = {
        overallLabel: 'Rata-rata Keseluruhan',
        overallCalculating: 'Rata-rata Keseluruhan: Sedang dihitung...',
        overallPlaceholder: 'Rata-rata Keseluruhan: --',
        overallNoData: 'Rata-rata Keseluruhan: Tidak ada data',
        overallError: 'Rata-rata Keseluruhan: Terjadi kesalahan',
        overallButton: 'Hitung Rata-rata Keseluruhan',
        statsButton: 'Statistik Nilai',
        refreshButton: 'Refresh Data',
        statsLoading: 'Memuat Statistik...',
        refreshLoading: 'Menyegarkan...',
        statsTitle: 'Statistik Mata Pelajaran',
        statsEmpty: 'Belum ada data rata-rata. Silakan hitung rata-rata keseluruhan terlebih dahulu.',
        statsHighest: 'Rata-rata Tertinggi',
        statsLowest: 'Rata-rata Terendah',
        statsListTitle: 'Daftar Rata-rata (Tertinggi ke Terendah)',
        statsNo: 'No',
        statsSubject: 'Mapel',
        statsTeacher: 'Guru',
        statsAverage: 'Rata-rata',
        statsError: 'Tidak dapat memuat statistik saat ini.',
        subjectButton: 'Hitung Rata-rata Mapel',
        subjectUnavailable: 'Data mapel tidak tersedia.',
        subjectPlaceholder: 'Rata-rata Mapel: --',
        subjectNoData: 'Rata-rata Mapel: Tidak ada data',
        subjectLabel: 'Rata-rata Mapel',
        popupTitle: 'Detail Penilaian',
        popupCreated: 'Dibuat',
        popupUpdated: 'Diperbarui',
        recentButton: 'Nilai Terbaru',
        recentLoading: 'Memuat...',
        recentTitle: 'Nilai Terbaru',
        recentEmpty: 'Belum ada data nilai.',
        recentError: 'Tidak dapat memuat nilai terbaru.'
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const createClickableSpan = (text, onClick) => {
        const span = document.createElement("span");
        span.innerText = text;
        span.className = 'luisa-clickable';
        span.onclick = onClick;
        return span;
    };

    // ── Unified Modal System ──
    const Modal = (() => {
        const instances = new Map();

        const _build = (id) => {
            const overlay = document.createElement('div');
            overlay.className = 'luisa-modal-overlay';
            overlay.dataset.modalId = id;

            const container = document.createElement('div');
            container.className = 'luisa-modal-container';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'luisa-modal-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.addEventListener('click', () => hide(id));

            const content = document.createElement('div');
            content.className = 'luisa-modal-content';

            container.appendChild(closeBtn);
            container.appendChild(content);
            overlay.appendChild(container);
            document.body.appendChild(overlay);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) hide(id);
            });

            const instance = { overlay, container, content };
            instances.set(id, instance);
            return instance;
        };

        const show = (id, html) => {
            const modal = instances.get(id) || _build(id);
            modal.content.innerHTML = html;
            // Force a layout frame so the initial state (opacity 0, scale 0.7) renders
            // before transitioning to visible — otherwise the browser skips the animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    modal.overlay.classList.add('visible');
                });
            });
        };

        const hide = (id) => {
            const modal = instances.get(id);
            if (!modal) return;
            modal.overlay.classList.remove('visible');
        };

        const hideAll = () => instances.forEach((_, id) => hide(id));

        const showDetail = (data) => {
            show('detail', `
                <h2 class="luisa-popup-header">
                    ${data.assessment_name} - ${TEXT.popupTitle}
                </h2>
                <div class="luisa-popup-box">
                    <ul>
                        <li><strong>Nilai Dikunci:</strong> ${data.lock === 1 ? "Ya" : "Tidak"}</li>
                        <li><strong>Nilai Total:</strong> ${data.total_score}</li>
                        <li><strong>KKM:</strong> ${data.spc_assessment.pass_score}</li>
                        <li><strong>Lulus:</strong> ${data.final_score >= data.spc_assessment.pass_score ? "✅" : "❌"}</li>
                        <li><strong>Jumlah Siswa Lulus:</strong> ${data.spc_assessment.pass_count}/${data.spc_assessment.student_count}</li>
                        <li><strong>Jenis Nilai:</strong> ${JENIS_TUGAS[data.spc_assessment.subject_assessment.assessment_technique_id] || "Unknown"} (${data.spc_assessment.subject_assessment.assessment_technique_id})</li>
                        <li><strong>${TEXT.popupCreated}:</strong> ${formatDate(data.created_at)}</li>
                        <li><strong>${TEXT.popupUpdated}:</strong> ${formatDate(data.updated_at)}</li>
                    </ul>
                </div>
            `);
        };

        // Single global Escape handler
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideAll();
        });

        return { show, hide, hideAll, showDetail };
    })();

    const TableManager = {
        addClickableLinks(selector, apiData = null) {
            const tableBody = document.querySelector(selector);
            if (!tableBody) return;
            const rows = tableBody.querySelectorAll('tr');
            rows.forEach((row, index) => {
                if (row.querySelector('th') || row.classList.contains('average-row')) return;
                const td = row.children[1];
                if (!td || td.querySelector('span')) return;
                const originalText = td.innerText;
                const span = createClickableSpan(originalText, () => {
                    if (apiData) Modal.showDetail(apiData[index]);
                    else document.querySelectorAll(".btn-primary")[index]?.click();
                });
                td.innerHTML = "";
                td.appendChild(span);
            });
        }
    };

    const ensureSubjectList = async (force = false) => {
        if (!subjectListCache.length || force) {
            try {
                const response = await fetch(`https://www.luisa.id/api/get/score?nis=${NIS}&subject=&teacher=`);
                subjectListCache = await response.json();
            } catch (error) {
                console.error('Gagal mengambil daftar mapel:', error);
                subjectListCache = [];
            }
        }
        return subjectListCache;
    };

    const getSubjectMetaByIndex = async (index) => {
        const subjects = await ensureSubjectList();
        return subjects[index] || null;
    };



    const updateOverallAverageDisplay = (message) => {
        const display = document.getElementById('total-average-display');
        if (display) {
            display.innerText = message;
        }
    };

    const handleOverallAverageCalculation = async (button) => {
        if (!button) return;
        const originalText = button.innerText;
        if (cachedOverallAverage !== null) {
            updateOverallAverageDisplay(`${TEXT.overallLabel}: ${formatScore(cachedOverallAverage)}`);
            return;
        }
        button.disabled = true;
        button.innerText = 'Menghitung...';
        updateOverallAverageDisplay(TEXT.overallCalculating);
        try {
            const avg = await calculateTotalAverage();
            if (avg) {
                cachedOverallAverage = avg;
                updateOverallAverageDisplay(`${TEXT.overallLabel}: ${formatScore(avg)}`);
            } else {
                updateOverallAverageDisplay(TEXT.overallNoData);
            }
        } catch (error) {
            console.error('Gagal menampilkan rata-rata keseluruhan:', error);
            updateOverallAverageDisplay(TEXT.overallError);
        } finally {
            button.disabled = false;
            button.innerText = originalText;
        }
    };

    const ensureOverallAverageControls = (retryCount = 0, loading = false) => {
        let display = document.getElementById('total-average-display');

        if (!display) {
            const table = document.querySelector('.table');
            if (!table || !table.parentNode) {
                if (retryCount < 10) {
                    setTimeout(() => ensureOverallAverageControls(retryCount + 1, loading), 250);
                }
                return;
            }
            display = document.createElement('div');
            display.id = 'total-average-display';
            display.innerText = TEXT.overallPlaceholder;
            table.parentNode.insertBefore(display, table);

        }

        let wrapper = document.getElementById('overall-average-controls');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'overall-average-controls';

            const parent = display.parentNode;
            if (!parent) return;
            parent.insertBefore(wrapper, display);
        }

        if (!wrapper.contains(display)) {
            wrapper.insertBefore(display, wrapper.firstChild);
        }

        let actionGroup = document.getElementById('overall-actions-group');
        if (!actionGroup) {
            actionGroup = document.createElement('div');
            actionGroup.id = 'overall-actions-group';
            wrapper.appendChild(actionGroup);
        }

        if (!document.getElementById('overall-average-button')) {
            const avgButton = document.createElement('button');
            avgButton.id = 'overall-average-button';
            avgButton.className = 'btn btn-success btn-sm';
            avgButton.innerText = TEXT.overallButton;
            avgButton.disabled = loading;
            avgButton.addEventListener('click', () => handleOverallAverageCalculation(avgButton));
            actionGroup.appendChild(avgButton);
        }

        if (!document.getElementById('overall-stats-button')) {
            const statsButton = document.createElement('button');
            statsButton.id = 'overall-stats-button';
            statsButton.className = 'btn btn-info btn-sm';
            statsButton.innerText = TEXT.statsButton;
            statsButton.disabled = loading;
            statsButton.addEventListener('click', () => handleShowStatistics(statsButton));
            actionGroup.appendChild(statsButton);
        }

        if (!document.getElementById('overall-refresh-button')) {
            const refreshButton = document.createElement('button');
            refreshButton.id = 'overall-refresh-button';
            refreshButton.className = 'btn btn-secondary btn-sm';
            refreshButton.innerText = TEXT.refreshButton;
            refreshButton.disabled = loading;
            refreshButton.addEventListener('click', () => handleRefreshData(refreshButton));
            actionGroup.appendChild(refreshButton);
        }

        if (!document.getElementById('overall-recent-button')) {
            const recentButton = document.createElement('button');
            recentButton.id = 'overall-recent-button';
            recentButton.className = 'btn btn-warning btn-sm';
            recentButton.innerText = TEXT.recentButton;
            recentButton.disabled = loading;
            recentButton.addEventListener('click', () => handleShowRecentScores(recentButton));
            actionGroup.appendChild(recentButton);
        }


    };

    const enableOverallButtons = () => {
        ['overall-average-button', 'overall-stats-button', 'overall-refresh-button', 'overall-recent-button'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        });
    };

    const computeSubjectAverage = (data = []) => {
        if (!Array.isArray(data) || !data.length) return null;
        let sum = 0;
        let count = 0;
        data.forEach((item) => {
            const score = parseFloat(item.total_score);
            if (!Number.isNaN(score)) {
                sum += score;
                count += 1;
            }
        });
        if (!count) return null;
        return parseFloat((sum / count).toFixed(2));
    };

    const fetchSubjectDetails = async (subjectId, force = false) => {
        if (!subjectId) return [];
        if (!force && subjectDetailCache.has(subjectId)) {
            return subjectDetailCache.get(subjectId);
        }
        if (!force && subjectDetailPromises.has(subjectId)) {
            return subjectDetailPromises.get(subjectId);
        }

        const promise = fetch(`https://www.luisa.id/api/get/detail_score?nis=${NIS}&id=${subjectId}`)
            .then((response) => response.json())
            .then(async (data) => {
                subjectDetailCache.set(subjectId, data);
                subjectDetailPromises.delete(subjectId);
                return data;
            })
            .catch((error) => {
                console.error('Gagal mengambil detail mapel:', error);
                subjectDetailPromises.delete(subjectId);
                return [];
            });

        subjectDetailPromises.set(subjectId, promise);
        return promise;
    };

    const collectSubjectAverages = async (force = false) => {
        const subjects = await ensureSubjectList(force);
        if (!subjects.length) return [];

        const detailResults = await Promise.all(
            subjects.map(({ id }) => fetchSubjectDetails(id, force))
        );

        const averages = subjects.map((subject, index) => {
            const subjectName = subject.subject_active?.name || `Mapel ${index + 1}`;
            const average = computeSubjectAverage(detailResults[index]);
            return {
                id: subject.id,
                name: subjectName,
                teacher: subject.teaching_subjects?.[0]?.teacher_name || '-',
                average,
                excluded: isExcludedSubject(subjectName),
                details: detailResults[index]
            };
        }).filter(entry => entry.average !== null);

        return averages;
    };

    const getAllSubjectAverages = async (force = false) => {
        if (!force && Array.isArray(cachedSubjectAverages) && cachedSubjectAverages.length) {
            return cachedSubjectAverages;
        }
        const averages = await collectSubjectAverages(force);
        cachedSubjectAverages = averages;
        return averages;
    };

    const buildStatisticsHtml = (averages) => {
        if (!averages.length) {
            return `
                <h2 style="margin-top: 0;">${TEXT.statsTitle}</h2>
                <p>${TEXT.statsEmpty}</p>
            `;
        }

        const sorted = [...averages].sort((a, b) => b.average - a.average);
        const highest = sorted[0];
        const lowest = sorted[sorted.length - 1];

        const rows = sorted.map((entry, index) => {
            const isExcluded = entry.excluded;
            const nameStyle = isExcluded ? 'text-decoration: line-through; opacity: 0.5;' : '';
            const suffix = isExcluded ? ' <small>(tidak dihitung)</small>' : '';
            return `
            <tr style="${nameStyle}">
                <td>${index + 1}</td>
                <td><a href="#" class="stats-subject-link" data-subject-id="${entry.id}">${entry.name}</a>${suffix}</td>
                <td>${entry.teacher}</td>
                <td>${formatScore(entry.average)}</td>
            </tr>
        `;
        }).join('');

        return `
            <h2 style="margin-top: 0;">${TEXT.statsTitle}</h2>
            <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:20px;">
                <div class="stats-card stats-card-high">
                    <h3>${TEXT.statsHighest}</h3>
                    <p class="score">${formatScore(highest.average)}</p>
                    <p class="name">${highest.name}</p>
                    <small>${highest.teacher}</small>
                </div>
                <div class="stats-card stats-card-low">
                    <h3>${TEXT.statsLowest}</h3>
                    <p class="score">${formatScore(lowest.average)}</p>
                    <p class="name">${lowest.name}</p>
                    <small>${lowest.teacher}</small>
                </div>
            </div>
            <h3 style="margin: 20px 0 10px;">${TEXT.statsListTitle}</h3>
            <div style="overflow-x:auto;">
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>${TEXT.statsNo}</th>
                            <th>${TEXT.statsSubject}</th>
                            <th>${TEXT.statsTeacher}</th>
                            <th>${TEXT.statsAverage}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    };

    const handleShowStatistics = async (button) => {
        const targetButton = button || document.getElementById('overall-stats-button');
        if (targetButton) {
            targetButton.disabled = true;
            targetButton.innerText = TEXT.statsLoading;
        }
        try {
            const averages = await getAllSubjectAverages();
            const html = buildStatisticsHtml(averages);
            Modal.show('stats', html);
            setTimeout(attachStatsLinkHandlers, 0);
        } catch (error) {
            console.error('Gagal menampilkan statistik:', error);
            Modal.show('stats', `<p>${TEXT.statsError}</p>`);
        } finally {
            if (targetButton) {
                targetButton.disabled = false;
                targetButton.innerText = TEXT.statsButton;
            }
        }
    };

    const buildRecentScoresHtml = (allDetails) => {
        // Flatten all assignments with their subject name attached
        const flat = [];
        allDetails.forEach(({ subjectName, details }) => {
            details.forEach(item => {
                const score = parseFloat(item.total_score);
                if (Number.isNaN(score)) return;
                flat.push({
                    name: item.assessment_name,
                    subject: subjectName,
                    score,
                    type: JENIS_TUGAS[item.spc_assessment?.subject_assessment?.assessment_technique_id] || '',
                    updatedAt: new Date(item.updated_at),
                    createdAt: new Date(item.created_at),
                    data: item
                });
            });
        });

        // Sort by most recently updated, then by created
        flat.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);

        const top = flat.slice(0, 15);

        if (!top.length) {
            return `
                <h2 style="margin-top: 0;">${TEXT.recentTitle}</h2>
                <p>${TEXT.recentEmpty}</p>
            `;
        }

        const timeAgo = (date) => {
            const now = new Date();
            const diff = Math.floor((now - date) / 1000);
            if (diff < 60) return 'baru saja';
            if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
            if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
            return formatDate(date);
        };

        const items = top.map(entry => {
            const badge = entry.type ? `<span class="recent-score-badge">${entry.type}</span>` : '';
            return `
                <div class="recent-score-item" data-recent-detail='${JSON.stringify(entry.data).replace(/'/g, "&#39;")}'>
                    <div class="recent-score-left">
                        <div class="recent-score-name">${entry.name}</div>
                        <div class="recent-score-subject">${entry.subject} ${badge}</div>
                    </div>
                    <div class="recent-score-right">
                        <div class="recent-score-value">${formatScore(entry.score)}</div>
                        <div class="recent-score-date">${timeAgo(entry.updatedAt)}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <h2 style="margin-top: 0;">${TEXT.recentTitle}</h2>
            <div>${items}</div>
        `;
    };

    const attachRecentClickHandlers = () => {
        document.querySelectorAll('.recent-score-item').forEach(el => {
            if (el.dataset.bound === 'true') return;
            el.dataset.bound = 'true';
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                try {
                    const data = JSON.parse(el.dataset.recentDetail);
                    Modal.showDetail(data);
                } catch (e) { /* ignore parse errors */ }
            });
        });
    };

    const handleShowRecentScores = async (button) => {
        const targetButton = button || document.getElementById('overall-recent-button');
        if (targetButton) {
            targetButton.disabled = true;
            targetButton.innerText = TEXT.recentLoading;
        }
        try {
            const subjects = await ensureSubjectList();
            const detailResults = await Promise.all(
                subjects.map(({ id }) => fetchSubjectDetails(id))
            );
            const allDetails = subjects.map((subject, index) => ({
                subjectName: subject.subject_active?.name || `Mapel ${index + 1}`,
                details: detailResults[index]
            }));
            const html = buildRecentScoresHtml(allDetails);
            Modal.show('recent', html);
            setTimeout(attachRecentClickHandlers, 0);
        } catch (error) {
            console.error('Gagal menampilkan nilai terbaru:', error);
            Modal.show('recent', `<p>${TEXT.recentError}</p>`);
        } finally {
            if (targetButton) {
                targetButton.disabled = false;
                targetButton.innerText = TEXT.recentButton;
            }
        }
    };

    const handleRefreshData = async (button) => {
        const targetButton = button || document.getElementById('overall-refresh-button');
        if (targetButton) {
            targetButton.disabled = true;
            targetButton.innerText = TEXT.refreshLoading;
        }
        subjectListCache = [];
        subjectDetailCache.clear();
        subjectDetailPromises.clear();
        cachedOverallAverage = null;
        cachedSubjectAverages = null;
        latestSubjectDetail = [];
        latestSubjectName = '';
        updateOverallAverageDisplay(TEXT.overallPlaceholder);

        try {
            await ensureSubjectList(true);
            ensureOverallAverageControls();
        } finally {
            if (targetButton) {
                targetButton.disabled = false;
                targetButton.innerText = TEXT.refreshButton;
            }
        }
    };

    const ensureSubjectAverageControls = () => {
        const detailTable = document.querySelector('.table-uh');
        if (!detailTable) return null;

        let wrapper = document.getElementById('subject-average-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'subject-average-wrapper';

            const button = document.createElement('button');
            button.id = 'subject-average-button';
            button.className = 'btn btn-outline-primary btn-sm';
            button.innerText = TEXT.subjectButton;
            button.addEventListener('click', () => {
                if (!latestSubjectDetail.length) {
                    const result = document.getElementById('subject-average-result');
                    if (result) result.innerText = TEXT.subjectUnavailable;
                    return;
                }
                const avg = computeSubjectAverage(latestSubjectDetail);
                const result = document.getElementById('subject-average-result');
                if (result) {
                    if (avg !== null) {
                        result.innerText = `${latestSubjectName || TEXT.statsSubject}: ${formatScore(avg)}`;
                    } else {
                        result.innerText = TEXT.subjectNoData;
                    }
                }
            });

            const result = document.createElement('div');
            result.id = 'subject-average-result';
            result.innerText = TEXT.subjectPlaceholder;

            wrapper.appendChild(result);
            wrapper.appendChild(button);

            detailTable.parentNode.insertBefore(wrapper, detailTable);
        }

        return wrapper;
    };

    const renderSubjectAverageUI = (subjectName, detailData, retryCount = 0) => {
        latestSubjectName = subjectName || TEXT.statsSubject;
        latestSubjectDetail = Array.isArray(detailData) ? detailData : [];
        const wrapper = ensureSubjectAverageControls();
        if (!wrapper) {
            if (retryCount < 5) {
                setTimeout(() => renderSubjectAverageUI(subjectName, detailData, retryCount + 1), 250);
            }
            return;
        }
        const result = document.getElementById('subject-average-result');
        if (result) {
            result.innerText = TEXT.subjectPlaceholder;
        }
    };

    const removeSubjectAverageControls = () => {
        const wrapper = document.getElementById('subject-average-wrapper');
        if (wrapper && wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
        latestSubjectDetail = [];
        latestSubjectName = '';
    };

    const getSubjectNameFromButton = (button) => {
        if (!button) return TEXT.statsSubject;
        const row = button.closest('tr');
        if (!row) return TEXT.statsSubject;
        const desktopCell = row.querySelector('td:nth-child(2)');
        if (desktopCell && desktopCell.innerText.trim()) {
            return desktopCell.innerText.trim();
        }
        const mobileCell = row.querySelector('td a');
        if (mobileCell && mobileCell.innerText.trim()) {
            return mobileCell.innerText.trim();
        }
        return TEXT.statsSubject;
    };

    const calculateTotalAverage = async () => {
        try {
            const averages = await collectSubjectAverages();
            const included = averages.filter(e => !e.excluded);
            if (!included.length) return null;
            const sum = included.reduce((acc, entry) => acc + entry.average, 0);
            const avg = parseFloat((sum / included.length).toFixed(2));
            return avg;
        } catch (e) {
            console.error('Gagal menghitung rata-rata keseluruhan:', e);
            return null;
        }
    };

    // ── DOM Observer Utility ──
    const settle = (ms = 200) => new Promise(r => setTimeout(r, ms));

    const waitForElement = (selector, timeout = 10000) => {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) { resolve(el); return; }

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                const el = document.querySelector(selector);
                if (el) resolve(el);
                else reject(new Error(`Timeout waiting for: ${selector}`));
            }, timeout);
        });
    };

    const waitForElementGone = (selector, timeout = 10000) => {
        return new Promise((resolve, reject) => {
            if (!document.querySelector(selector)) { resolve(); return; }

            const observer = new MutationObserver(() => {
                if (!document.querySelector(selector)) {
                    observer.disconnect();
                    resolve();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                if (!document.querySelector(selector)) resolve();
                else reject(new Error(`Timeout waiting for removal: ${selector}`));
            }, timeout);
        });
    };

    document.addEventListener("DOMContentLoaded", async function () {
        // Extract NIS safely (no double query)
        const dropdowns = document.querySelectorAll('.nav-link.dropdown-toggle');
        const lastDropdown = dropdowns[dropdowns.length - 1];
        NIS = lastDropdown?.textContent.match(/\d+(\.\d+)?/g)?.[0] ?? '';

        // Show buttons greyed out immediately, then enable after data loads
        try {
            await waitForElement('.table tbody');
            await settle();
            ensureOverallAverageControls(0, true);
            await ensureSubjectList();
            TableManager.addClickableLinks('.table tbody');
            enableOverallButtons();
        } catch (e) {
            console.error('Gagal menginisialisasi tabel utama:', e);
        }

        document.body.addEventListener("click", async (event) => {
            const button = event.target.closest("button.btn.btn-primary");
            if (!button) return;

            if (button.textContent.includes("Detail")) {
                const detailButtons = [...document.querySelectorAll("button.btn.btn-primary")]
                    .filter(btn => btn.textContent.includes("Detail"));
                const index = detailButtons.indexOf(button);
                const subjectMeta = index >= 0 ? await getSubjectMetaByIndex(index) : null;
                const subjectId = subjectMeta ? subjectMeta.id : null;
                const subjectName = subjectMeta?.subject_active?.name || getSubjectNameFromButton(button);
                if (!subjectId) return;

                // Start fetch immediately, wait for DOM in parallel
                const detailPromise = fetchSubjectDetails(subjectId);
                try {
                    const [, apiData] = await Promise.all([
                        waitForElement('.table-uh tbody').then(() => settle()),
                        detailPromise
                    ]);
                    renderSubjectAverageUI(subjectName, apiData);
                    TableManager.addClickableLinks('.table-uh tbody', apiData);
                } catch (error) {
                    console.error('Gagal mengambil detail mapel:', error);
                }
            } else if (button.textContent.includes("Kembali")) {
                removeSubjectAverageControls();
                try {
                    // Wait for detail table to be REMOVED first, then settle
                    await waitForElementGone('.table-uh');
                    await settle(300);
                    TableManager.addClickableLinks('.table tbody');
                    ensureOverallAverageControls();
                } catch (error) {
                    console.error('Gagal kembali ke tabel utama:', error);
                }
            }
        });
    });
})();