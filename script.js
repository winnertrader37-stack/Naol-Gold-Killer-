"use strict";

/* ==========================================================
   NAOL FX AI ANALYZER
   Live TradingView Chart Controller
   Version 1.0
   ========================================================== */

document.addEventListener("DOMContentLoaded", function () {

    /* ------------------------------------------------------
       1. CONFIGURATION
    ------------------------------------------------------ */

    const CONFIG = {
        defaultSymbol: "OANDA:XAUUSD",
        defaultInterval: "5",
        timezone: "Africa/Addis_Ababa",

        markets: {
            "XAUUSD": {
                symbol: "OANDA:XAUUSD",
                name: "Gold / US Dollar"
            },

            "BTCUSD": {
                symbol: "BITSTAMP:BTCUSD",
                name: "Bitcoin / US Dollar"
            },

            "ETHUSD": {
                symbol: "COINBASE:ETHUSD",
                name: "Ethereum / US Dollar"
            }
        }
    };


    /* ------------------------------------------------------
       2. ELEMENTS
    ------------------------------------------------------ */

    const chartContainer =
        document.getElementById("tradingview_chart");

    const connectionStatus =
        document.getElementById("connectionStatus");

    const selectedSymbol =
        document.getElementById("selectedSymbol");

    const selectedMarketName =
        document.getElementById("selectedMarketName");

    const currentTimeframe =
        document.getElementById("currentTimeframe");

    const marketButtons =
        document.querySelectorAll(".market-card");

    const timeframeButtons =
        document.querySelectorAll(
            ".timeframe-buttons button"
        );

    const currentYear =
        document.getElementById("currentYear");


    /* ------------------------------------------------------
       3. APPLICATION STATE
    ------------------------------------------------------ */

    let activeMarket = "XAUUSD";
    let activeInterval = CONFIG.defaultInterval;

    let chartWidget = null;
    let chartLoadTimer = null;
    let chartLoadId = 0;


    /* ------------------------------------------------------
       4. STATUS HELPERS
    ------------------------------------------------------ */

    function setStatus(message) {

        if (connectionStatus) {
            connectionStatus.textContent = message;
        }

    }


    function showChartMessage(message) {

        if (!chartContainer) {
            return;
        }

        chartContainer.innerHTML = `
            <div class="chart-loading">
                <p>${escapeHTML(message)}</p>
            </div>
        `;

    }


    function escapeHTML(value) {

        return String(value).replace(
            /[&<>"']/g,
            function (character) {
                const entities = {
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;"
                };

                return entities[character];
            }
        );

    }


    /* ------------------------------------------------------
       5. UPDATE MARKET DISPLAY
    ------------------------------------------------------ */

    function updateMarketDisplay(marketKey) {

        const market = CONFIG.markets[marketKey];

        if (!market) {
            return;
        }

        activeMarket = marketKey;

        if (selectedSymbol) {
            selectedSymbol.textContent = marketKey;
        }

        if (selectedMarketName) {
            selectedMarketName.textContent = market.name;
        }

        marketButtons.forEach(function (button) {

            const isActive =
                button.dataset.name === marketKey;

            button.classList.toggle(
                "active",
                isActive
            );

            button.setAttribute(
                "aria-pressed",
                String(isActive)
            );

        });

    }


    /* ------------------------------------------------------
       6. UPDATE TIMEFRAME DISPLAY
    ------------------------------------------------------ */

    function updateTimeframeDisplay(interval) {

        activeInterval = String(interval);

        const labels = {
            "1": "M1",
            "5": "M5",
            "15": "M15",
            "30": "M30",
            "60": "H1",
            "240": "H4"
        };

        const label =
            labels[activeInterval] || "M5";

        timeframeButtons.forEach(function (button) {

            const isActive =
                button.dataset.interval === activeInterval;

            button.classList.toggle(
                "selected",
                isActive
            );

            button.setAttribute(
                "aria-pressed",
                String(isActive)
            );

        });

        if (currentTimeframe) {
            currentTimeframe.textContent =
                "TIMEFRAME: " + label;
        }

    }


    /* ------------------------------------------------------
       7. LOAD TRADINGVIEW LIBRARY
    ------------------------------------------------------ */

    function loadTradingViewLibrary() {

        if (window.TradingView) {
            return Promise.resolve();
        }

        return new Promise(function (resolve, reject) {

            let script =
                document.querySelector(
                    'script[src="https://s3.tradingview.com/tv.js"]'
                );

            if (script && script.dataset.loaded === "true") {
                resolve();
                return;
            }

            if (!script) {

                script = document.createElement("script");

                script.src =
                    "https://s3.tradingview.com/tv.js";

                script.async = true;

                document.head.appendChild(script);

            }

            const onLoad = function () {

                script.dataset.loaded = "true";

                cleanup();

                if (window.TradingView) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            "TradingView library is unavailable."
                        )
                    );
                }

            };

            const onError = function () {

                cleanup();

                reject(
                    new Error(
                        "TradingView library could not be loaded."
                    )
                );

            };

            const cleanup = function () {

                script.removeEventListener(
                    "load",
                    onLoad
                );

                script.removeEventListener(
                    "error",
                    onError
                );

            };

            script.addEventListener(
                "load",
                onLoad,
                { once: true }
            );

            script.addEventListener(
                "error",
                onError,
                { once: true }
            );

            if (window.TradingView) {
                cleanup();
                resolve();
            }

        });

    }


    /* ------------------------------------------------------
       8. CREATE TRADINGVIEW CHART
    ------------------------------------------------------ */

    async function loadChart() {

        if (!chartContainer) {
            console.error(
                "Chart container was not found."
            );
            return;
        }

        const market = CONFIG.markets[activeMarket];

        if (!market) {
            showChartMessage(
                "Selected market is unavailable."
            );
            return;
        }

        const thisLoadId = ++chartLoadId;

        if (chartLoadTimer) {
            clearTimeout(chartLoadTimer);
        }

        setStatus("Loading chart...");

        showChartMessage(
            "Connecting to TradingView..."
        );

        try {

            await loadTradingViewLibrary();

            /*
             * Ignore older loading requests if the user
             * changes market or timeframe while loading.
             */

            if (thisLoadId !== chartLoadId) {
                return;
            }

            chartContainer.innerHTML = "";

            chartWidget = null;

            const widgetOptions = {
                autosize: true,

                symbol: market.symbol,

                interval: activeInterval,

                timezone: CONFIG.timezone,

                theme: "dark",

                style: "1",

                locale: "en",

                enable_publishing: false,

                allow_symbol_change: true,

                save_image: true,

                hide_side_toolbar: false,

                withdateranges: true,

                details: false,

                hotlist: false,

                calendar: false,

                support_host: "https://www.tradingview.com",

                container_id: "tradingview_chart"
            };

            chartWidget =
                new window.TradingView.widget(
                    widgetOptions
                );

            setStatus("Chart requested");

            /*
             * The embedded chart runs inside a cross-origin
             * iframe. We cannot reliably inspect its market
             * connection status from this page.
             */

            chartLoadTimer = setTimeout(
                function () {

                    if (thisLoadId !== chartLoadId) {
                        return;
                    }

                    setStatus("Chart embedded");

                },
                2500
            );

        } catch (error) {

            console.error(
                "TradingView chart error:",
                error
            );

            if (thisLoadId !== chartLoadId) {
                return;
            }

            setStatus("Chart unavailable");

            showChartMessage(
                "Chart could not load. Check your internet connection and try again."
            );

        }

    }


    /* ------------------------------------------------------
       9. MARKET BUTTON EVENTS
    ------------------------------------------------------ */

    marketButtons.forEach(function (button) {

        button.addEventListener(
            "click",
            function () {

                const marketKey = button.dataset.name;

                if (!CONFIG.markets[marketKey]) {
                    return;
                }

                updateMarketDisplay(marketKey);

                loadChart();

            }
        );

    });


    /* ------------------------------------------------------
       10. TIMEFRAME BUTTON EVENTS
    ------------------------------------------------------ */

    timeframeButtons.forEach(function (button) {

        button.addEventListener(
            "click",
            function () {

                const interval =
                    button.dataset.interval;

                const allowedIntervals = [
                    "1",
                    "5",
                    "15",
                    "30",
                    "60",
                    "240"
                ];

                if (
                    !allowedIntervals.includes(interval)
                ) {
                    return;
                }

                updateTimeframeDisplay(interval);

                loadChart();

            }
        );

    });


    /* ------------------------------------------------------
       11. INITIALIZE FOOTER
    ------------------------------------------------------ */

    if (currentYear) {
        currentYear.textContent =
            String(new Date().getFullYear());
    }


    /* ------------------------------------------------------
       12. INITIALIZE MARKET AND TIMEFRAME
    ------------------------------------------------------ */

    updateMarketDisplay("XAUUSD");

    updateTimeframeDisplay("5");


    /* ------------------------------------------------------
       13. START APPLICATION
    ------------------------------------------------------ */

    if (!chartContainer) {

        setStatus("Chart container missing");

        console.error(
            "Add the tradingview_chart element to index.html."
        );

        return;

    }

    loadChart();


    /* ------------------------------------------------------
       14. PUBLIC DEBUG INFORMATION
    ------------------------------------------------------ */

    window.NaolFXAnalyzer = {

        getActiveMarket: function () {
            return activeMarket;
        },

        getActiveTimeframe: function () {
            return activeInterval;
        },

        reloadChart: function () {
            loadChart();
        }

    };

});
