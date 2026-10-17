// Populate the sidebar
//
// This is a script, and not included directly in the page, to control the total size of the book.
// The TOC contains an entry for each page, so if each page includes a copy of the TOC,
// the total size of the page becomes O(n**2).
class MDBookSidebarScrollbox extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.innerHTML = '<ol class="chapter"><li class="chapter-item affix "><li class="part-title">平台介绍</li><li class="chapter-item "><a href="intro/about.html"><strong aria-hidden="true">1.</strong> 平台简介</a></li><li class="chapter-item "><a href="intro/architecture.html"><strong aria-hidden="true">2.</strong> 系统架构</a></li><li class="chapter-item affix "><li class="part-title">玩家指南</li><li class="chapter-item "><a href="player/register.html"><strong aria-hidden="true">3.</strong> 注册与登录</a></li><li class="chapter-item "><a href="player/lobby.html"><strong aria-hidden="true">4.</strong> 游戏大厅</a></li><li class="chapter-item "><a href="player/play.html"><strong aria-hidden="true">5.</strong> 开始游戏</a></li><li class="chapter-item "><a href="player/recharge.html"><strong aria-hidden="true">6.</strong> 充值</a></li><li class="chapter-item "><a href="player/profile.html"><strong aria-hidden="true">7.</strong> 个人中心</a></li><li class="chapter-item "><a href="player/notifications.html"><strong aria-hidden="true">8.</strong> 通知中心</a></li><li class="chapter-item "><a href="player/safety.html"><strong aria-hidden="true">9.</strong> 合规与账户安全</a></li><li class="chapter-item affix "><li class="part-title">运营管理</li><li class="chapter-item "><a href="admin/overview.html"><strong aria-hidden="true">10.</strong> 管理后台概览</a></li><li class="chapter-item affix "><li class="part-title">开发商接入指南</li><li class="chapter-item "><a href="dev/overview.html"><strong aria-hidden="true">11.</strong> 接入总览</a></li><li class="chapter-item "><a href="dev/quick-start.html"><strong aria-hidden="true">12.</strong> 快速开始</a></li><li class="chapter-item "><a href="dev/onboarding.html"><strong aria-hidden="true">13.</strong> 入驻与创建游戏</a></li><li class="chapter-item "><a href="dev/game-backend.html"><strong aria-hidden="true">14.</strong> 游戏逻辑开发</a></li><li class="chapter-item "><a href="dev/game-frontend.html"><strong aria-hidden="true">15.</strong> 游戏前端开发</a></li><li class="chapter-item "><a href="dev/protocol.html"><strong aria-hidden="true">16.</strong> 事件与协议规范</a></li><li class="chapter-item "><a href="dev/funds.html"><strong aria-hidden="true">17.</strong> 资金接入</a></li><li class="chapter-item "><a href="dev/review.html"><strong aria-hidden="true">18.</strong> 提交与审核</a></li><li class="chapter-item "><a href="dev/local-dev.html"><strong aria-hidden="true">19.</strong> 本地开发与自测</a></li><li class="chapter-item "><a href="dev/ops-errors.html"><strong aria-hidden="true">20.</strong> 错误处理</a></li><li class="chapter-item "><a href="dev/limits.html"><strong aria-hidden="true">21.</strong> 平台限制与接入清单</a></li><li class="chapter-item "><a href="dev/faq.html"><strong aria-hidden="true">22.</strong> 常见问题 FAQ</a></li><li class="chapter-item "><a href="dev/sdk-download.html"><strong aria-hidden="true">23.</strong> SDK 下载</a></li></ol>';
        // Set the current, active page, and reveal it if it's hidden
        let current_page = document.location.href.toString().split("#")[0].split("?")[0];
        if (current_page.endsWith("/")) {
            current_page += "index.html";
        }
        var links = Array.prototype.slice.call(this.querySelectorAll("a"));
        var l = links.length;
        for (var i = 0; i < l; ++i) {
            var link = links[i];
            var href = link.getAttribute("href");
            if (href && !href.startsWith("#") && !/^(?:[a-z+]+:)?\/\//.test(href)) {
                link.href = path_to_root + href;
            }
            // The "index" page is supposed to alias the first chapter in the book.
            if (link.href === current_page || (i === 0 && path_to_root === "" && current_page.endsWith("/index.html"))) {
                link.classList.add("active");
                var parent = link.parentElement;
                if (parent && parent.classList.contains("chapter-item")) {
                    parent.classList.add("expanded");
                }
                while (parent) {
                    if (parent.tagName === "LI" && parent.previousElementSibling) {
                        if (parent.previousElementSibling.classList.contains("chapter-item")) {
                            parent.previousElementSibling.classList.add("expanded");
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }
        // Track and set sidebar scroll position
        this.addEventListener('click', function(e) {
            if (e.target.tagName === 'A') {
                sessionStorage.setItem('sidebar-scroll', this.scrollTop);
            }
        }, { passive: true });
        var sidebarScrollTop = sessionStorage.getItem('sidebar-scroll');
        sessionStorage.removeItem('sidebar-scroll');
        if (sidebarScrollTop) {
            // preserve sidebar scroll position when navigating via links within sidebar
            this.scrollTop = sidebarScrollTop;
        } else {
            // scroll sidebar to current active section when navigating via "next/previous chapter" buttons
            var activeSection = document.querySelector('#sidebar .active');
            if (activeSection) {
                activeSection.scrollIntoView({ block: 'center' });
            }
        }
        // Toggle buttons
        var sidebarAnchorToggles = document.querySelectorAll('#sidebar a.toggle');
        function toggleSection(ev) {
            ev.currentTarget.parentElement.classList.toggle('expanded');
        }
        Array.from(sidebarAnchorToggles).forEach(function (el) {
            el.addEventListener('click', toggleSection);
        });
    }
}
window.customElements.define("mdbook-sidebar-scrollbox", MDBookSidebarScrollbox);
