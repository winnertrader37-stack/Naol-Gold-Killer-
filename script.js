"use strict";

/* ==========================================================
   NAOL FX AI ANALYZER
   Fast Market Analysis Dashboard
   Strategy:
   - Market Structure
   - EMA Trend
   - RSI Momentum
   - Candle Patterns
   - Support / Resistance
   - ATR-Based Stop Loss
   - Risk / Reward Targets

   IMPORTANT:
   This is a rule-based technical analyzer, not a guaranteed
   profitable AI trading system.
   ========================================================== */

document.addEventListener("DOMContentLoaded", function () {

    const CONFIG = {
        defaultSymbol: "OANDA:XAUUSD",
        defaultInterval: "5",
        timezone: "Africa/Addis_Ababa",
        requestTimeout: 9000,
        cacheDuration: 15000,

        markets: {
            XAUUSD: {
                symbol: "OANDA:XAUUSD",
                name: "Gold / US Dollar",
                source: "Yahoo Finance",
                yahooSymbol: "GC=F"
            },

            BTCUSD: {
                symbol: "BITSTAMP:BTCUSD",
                name: "Bitcoin / US Dollar",
                source: "Coinbase",
                coinbaseProduct: "BTC-USD"
            },

            ETHUSD: {
                symbol: "COINBASE:ETHUSD",
                name: "Ethereum / US Dollar",
                source: "Coinbase",
                coinbaseProduct: "ETH-USD"
            }
        }
    };

    const $ = function (id) {
        return document.getElementById(id);
    };

    const chartContainer = $("tradingview_chart");
    const connectionStatus = $("connectionStatus");
    const selectedSymbol = $("selectedSymbol");
    const selectedMarketName = $("selectedMarketName");
    const currentTimeframe = $("currentTimeframe");
    const currentYear = $("currentYear");

    const marketButtons = document.querySelectorAll(".market-card");
    const timeframeButtons = document.querySelectorAll(
        ".timeframe-buttons button"
    );

    let activeMarket = "XAUUSD";
    let activeInterval = CONFIG.defaultInterval;

    let chartWidget = null;
    let chartLoadTimer = null;
    let chartLoadId = 0;

    let analysisRunning = false;
    let analysisCache = new Map();
    let lastAnalysis = null;

    /* ======================================================
       GENERAL HELPERS
       ====================================================== */

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            const entities = {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            };

            return entities[character];
        });
    }

    function setStatus(message) {
        if (connectionStatus) {
            connectionStatus.textContent = message;
        }
    }

    function formatPrice(value) {
        if (!Number.isFinite(value)) {
            return "Unavailable";
        }

        if (Math.abs(value) >= 1000) {
            return value.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }

        if (Math.abs(value) >= 1) {
            return value.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4
            });
        }

        return value.toLocaleString("en-US", {
            minimumFractionDigits: 4,
            maximumFractionDigits: 8
        });
    }

    function formatNumber(value, digits) {
        if (!Number.isFinite(value)) {
            return "N/A";
        }

        return value.toFixed(digits === undefined ? 2 : digits);
    }

    function getTimeframeLabel(interval) {
        const labels = {
            "1": "M1",
            "5": "M5",
            "15": "M15",
            "30": "M30",
            "60": "H1",
            "240": "H4"
        };

        return labels[String(interval)] || "M5";
    }

    function getCacheKey() {
        return activeMarket + "_" + activeInterval;
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    async function fetchWithTimeout(url, timeoutMs) {
        const controller = new AbortController();

        const timeout = setTimeout(function () {
            controller.abort();
        }, timeoutMs || CONFIG.requestTimeout);

        try {
            const response = await fetch(url, {
                method: "GET",
                signal: controller.signal,
                cache: "no-store",
                headers: {
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(
                    "Market data server returned HTTP " + response.status
                );
            }

            return await response.json();

        } finally {
            clearTimeout(timeout);
        }
    }

    /* ======================================================
       MARKET / TIMEFRAME SELECTION
       ====================================================== */

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
            const active = button.dataset.name === marketKey;

            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        });

        updateAnalysisMarketLabel();
    }

    function updateTimeframeDisplay(interval) {
        activeInterval = String(interval);

        const label = getTimeframeLabel(activeInterval);

        timeframeButtons.forEach(function (button) {
            const active =
                String(button.dataset.interval) === activeInterval;

            button.classList.toggle("selected", active);
            button.setAttribute("aria-pressed", String(active));
        });

        if (currentTimeframe) {
            currentTimeframe.textContent = "TIMEFRAME: " + label;
        }

        const analysisTF = $("naolAnalysisTimeframe");

        if (analysisTF) {
            analysisTF.textContent = label;
        }
    }

    /* ======================================================
       TRADINGVIEW CHART
       ====================================================== */

    function showChartMessage(message) {
        if (!chartContainer) {
            return;
        }

        chartContainer.innerHTML =
            '<div class="chart-loading">' +
                "<p>" + escapeHTML(message) + "</p>" +
            "</div>";
    }

    function loadTradingViewLibrary() {
        if (window.TradingView) {
            return Promise.resolve();
        }

        return new Promise(function (resolve, reject) {

            let script = document.querySelector(
                'script[src="https://s3.tradingview.com/tv.js"]'
            );

            if (!script) {
                script = document.createElement("script");
                script.src = "https://s3.tradingview.com/tv.js";
                script.async = true;

                document.head.appendChild(script);
            }

            let finished = false;

            const cleanup = function () {
                script.removeEventListener("load", onLoad);
                script.removeEventListener("error", onError);
            };

            const onLoad = function () {
                if (finished) {
                    return;
                }

                finished = true;
                cleanup();

                if (window.TradingView) {
                    resolve();
                } else {
                    reject(
                        new Error("TradingView library is unavailable.")
                    );
                }
            };

            const onError = function () {
                if (finished) {
                    return;
                }

                finished = true;
                cleanup();

                reject(
                    new Error("TradingView library could not be loaded.")
                );
            };

            script.addEventListener("load", onLoad);
            script.addEventListener("error", onError);

            if (window.TradingView) {
                finished = true;
                cleanup();
                resolve();
            }
        });
    }

    async function loadChart() {
        if (!chartContainer) {
            setStatus("Chart container missing");
            return;
        }

        const market = CONFIG.markets[activeMarket];

        if (!market) {
            showChartMessage("Selected market is unavailable.");
            return;
        }

        const thisLoadId = ++chartLoadId;

        if (chartLoadTimer) {
            clearTimeout(chartLoadTimer);
        }

        setStatus("Loading chart...");

        showChartMessage("Connecting to TradingView...");

        try {
            await loadTradingViewLibrary();

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

            chartWidget = new window.TradingView.widget(widgetOptions);

            setStatus("Chart requested");

            chartLoadTimer = setTimeout(function () {
                if (thisLoadId !== chartLoadId) {
                    return;
                }

                setStatus("Chart embedded");
            }, 2500);

        } catch (error) {
            console.error("TradingView chart error:", error);

            if (thisLoadId !== chartLoadId) {
                return;
            }

            setStatus("Chart unavailable");

            showChartMessage(
                "Chart could not load. Check your internet connection."
            );
        }
    }

    /* ======================================================
       ANALYSIS PANEL
       Creates the panel automatically.
       No screenshot upload is required.
       ====================================================== */

    function installAnalysisStyles() {
        if ($("naolAnalysisStyles")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "naolAnalysisStyles";

        style.textContent = `
            .naol-analysis-panel {
                width: 100%;
                box-sizing: border-box;
                margin: 24px 0;
                padding: 22px;
                border-radius: 20px;
                color: #edf5ff;
                background:
                    radial-gradient(
                        circle at top right,
                        rgba(0, 212, 255, 0.12),
                        transparent 36%
                    ),
                    linear-gradient(145deg, #101b32, #080e1b);
                border: 1px solid rgba(88, 177, 255, 0.22);
                box-shadow:
                    0 14px 40px rgba(0, 0, 0, 0.28),
                    inset 0 1px 0 rgba(255, 255, 255, 0.04);
                font-family: Arial, sans-serif;
            }

            .naol-analysis-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                margin-bottom: 18px;
            }

            .naol-analysis-heading {
                margin: 0;
                font-size: 21px;
                font-weight: 800;
                letter-spacing: 0.3px;
            }

            .naol-analysis-subtitle {
                margin: 7px 0 0;
                color: #91a8c9;
                font-size: 12px;
                line-height: 1.6;
            }

            .naol-analysis-badge {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                padding: 8px 11px;
                border-radius: 999px;
                background: rgba(0, 220, 180, 0.09);
                color: #56f2cb;
                border: 1px solid rgba(86, 242, 203, 0.2);
                font-size: 11px;
                font-weight: 800;
            }

            .naol-analysis-controls {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
                margin-bottom: 18px;
            }

            .naol-analysis-button {
                flex: 1 1 210px;
                min-height: 48px;
                border: 0;
                border-radius: 12px;
                padding: 13px 16px;
                cursor: pointer;
                color: #04121d;
                font-size: 13px;
                font-weight: 900;
                letter-spacing: 0.4px;
                background: linear-gradient(135deg, #42e8ff, #448aff);
                box-shadow: 0 7px 22px rgba(45, 158, 255, 0.2);
                transition: transform 0.15s ease, opacity 0.15s ease;
            }

            .naol-analysis-button:hover {
                transform: translateY(-2px);
            }

            .naol-analysis-button:disabled {
                opacity: 0.6;
                cursor: wait;
                transform: none;
            }

            .naol-analysis-market {
                display: flex;
                flex-direction: column;
                justify-content: center;
                min-width: 120px;
                padding: 10px 14px;
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.08);
                background: rgba(255,255,255,0.035);
            }

            .naol-analysis-market small {
                color: #8ba2c4;
                font-size: 10px;
                margin-bottom: 5px;
            }

            .naol-analysis-market strong {
                font-size: 14px;
                color: #eaf5ff;
            }

            .naol-analysis-result {
                display: none;
                margin-top: 12px;
            }

            .naol-analysis-result.visible {
                display: block;
            }

            .naol-analysis-signal {
                padding: 17px;
                border-radius: 15px;
                background: rgba(255,255,255,0.035);
                border: 1px solid rgba(255,255,255,0.07);
                margin-bottom: 13px;
            }

            .naol-analysis-signal.buy {
                border-color: rgba(45, 236, 165, 0.4);
                background: rgba(20, 180, 120, 0.075);
            }

            .naol-analysis-signal.sell {
                border-color: rgba(255, 90, 112, 0.4);
                background: rgba(255, 70, 100, 0.07);
            }

            .naol-analysis-signal.wait {
                border-color: rgba(255, 192, 75, 0.35);
                background: rgba(255, 192, 75, 0.05);
            }

            .naol-analysis-signal-label {
                color: #9bb0cd;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 1.3px;
            }

            .naol-analysis-signal-value {
                margin-top: 8px;
                font-size: 31px;
                font-weight: 900;
                letter-spacing: 1px;
            }

            .naol-analysis-signal.buy .naol-analysis-signal-value {
                color: #35f0a9;
            }

            .naol-analysis-signal.sell .naol-analysis-signal-value {
                color: #ff6a82;
            }

            .naol-analysis-signal.wait .naol-analysis-signal-value {
                color: #ffd06d;
            }

            .naol-analysis-signal-note {
                margin-top: 8px;
                color: #a8bad3;
                font-size: 12px;
                line-height: 1.6;
            }

            .naol-analysis-grid {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
            }

            .naol-analysis-metric {
                min-width: 0;
                padding: 14px;
                border-radius: 12px;
                background: rgba(255,255,255,0.035);
                border: 1px solid rgba(255,255,255,0.06);
            }

            .naol-analysis-metric span {
                display: block;
                color: #8da4c6;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.7px;
                margin-bottom: 8px;
            }

            .naol-analysis-metric strong {
                display: block;
                overflow-wrap: anywhere;
                color: #eff7ff;
                font-size: 16px;
                font-weight: 800;
            }

            .naol-analysis-reason {
                margin-top: 13px;
                padding: 14px;
                border-radius: 12px;
                background: rgba(56, 117, 210, 0.08);
                border: 1px solid rgba(100, 155, 240, 0.12);
                color: #b5c8e5;
                font-size: 12px;
                line-height: 1.8;
            }

            .naol-analysis-source {
                margin-top: 13px;
                color: #7289aa;
                font-size: 10px;
                line-height: 1.7;
            }

            .naol-analysis-error {
                padding: 14px;
                border-radius: 12px;
                color: #ffc1cb;
                background: rgba(255, 65, 95, 0.08);
                border: 1px solid rgba(255, 65, 95, 0.2);
                font-size: 12px;
                line-height: 1.7;
            }

            .naol-analysis-disclaimer {
                margin-top: 15px;
                color: #7186a6;
                font-size: 10px;
                line-height: 1.7;
            }

            .naol-analysis-spinner {
                display: inline-block;
                width: 13px;
                height: 13px;
                border: 2px solid rgba(5, 25, 45, 0.25);
                border-top-color: #06182a;
                border-radius: 50%;
                animation: naolSpin 0.7s linear infinite;
                vertical-align: -2px;
                margin-right: 7px;
            }

            @keyframes naolSpin {
                to { transform: rotate(360deg); }
            }

            @media (max-width: 520px) {
                .naol-analysis-panel {
                    padding: 15px;
                    border-radius: 15px;
                }

                .naol-analysis-grid {
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }

                .naol-analysis-metric {
                    padding: 11px;
                }

                .naol-analysis-metric strong {
                    font-size: 13px;
                }

                .naol-analysis-heading {
                    font-size: 18px;
                }

                .naol-analysis-signal-value {
                    font-size: 27px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function installAnalysisPanel() {
        if ($("naolAnalysisPanel")) {
            return;
        }

        installAnalysisStyles();

        const panel = document.createElement("section");

        panel.id = "naolAnalysisPanel";
        panel.className = "naol-analysis-panel";

        panel.innerHTML = `
            <div class="naol-analysis-header">
                <div>
                    <h2 class="naol-analysis-heading">
                        ⚡ NAOL MARKET ANALYZER
                    </h2>

                    <p class="naol-analysis-subtitle">
                        Fast technical analysis using market candles,
                        trend, momentum and price structure.
                    </p>
                </div>

                <span class="naol-analysis-badge">
                    ● RULE-BASED ENGINE
                </span>
            </div>

            <div class="naol-analysis-controls">
                <div class="naol-analysis-market">
                    <small>ACTIVE MARKET</small>
                    <strong id="naolAnalysisMarket">XAUUSD</strong>
                </div>

                <div class="naol-analysis-market">
                    <small>TIMEFRAME</small>
                    <strong id="naolAnalysisTimeframe">M5</strong>
                </div>

                <button
                    type="button"
                    id="naolAnalyzeButton"
                    class="naol-analysis-button">
                    ⚡ ANALYZE MARKET
                </button>
            </div>

            <div
                id="naolAnalysisMessage"
                class="naol-analysis-subtitle"
                aria-live="polite">
                Choose a market and timeframe, then press Analyze Market.
            </div>

            <div
                id="naolAnalysisResult"
                class="naol-analysis-result">
            </div>

            <div class="naol-analysis-disclaimer">
                Educational technical analysis only. Signals are estimates,
                not guaranteed trading results. Data may differ from your
                Exness account. Check spread, slippage and broker prices
                before placing a trade.
            </div>
        `;

        /*
         * Prefer to place the analyzer immediately after the chart.
         * If the chart is not found, use the end of the page.
         */
        if (chartContainer && chartContainer.parentElement) {
            chartContainer.parentElement.insertAdjacentElement(
                "afterend",
                panel
            );
        } else {
            document.body.appendChild(panel);
        }

        const button = $("naolAnalyzeButton");

        if (button) {
            button.addEventListener("click", runAnalysis);
        }

        updateAnalysisMarketLabel();
    }

    function updateAnalysisMarketLabel() {
        const marketElement = $("naolAnalysisMarket");

        if (marketElement) {
            marketElement.textContent = activeMarket;
        }

        const timeframeElement = $("naolAnalysisTimeframe");

        if (timeframeElement) {
            timeframeElement.textContent =
                getTimeframeLabel(activeInterval);
        }
    }

    function setAnalysisMessage(message) {
        const element = $("naolAnalysisMessage");

        if (element) {
            element.textContent = message;
        }
    }

    function setAnalysisLoading(isLoading) {
        const button = $("naolAnalyzeButton");

        if (!button) {
            return;
        }

        button.disabled = isLoading;

        button.innerHTML = isLoading
            ? '<span class="naol-analysis-spinner"></span> ANALYZING...'
            : "⚡ ANALYZE MARKET";
    }

    /* ======================================================
       DATA PROVIDER: COINBASE CRYPTO CANDLES
       ====================================================== */

    function getCoinbaseGranularity(interval) {
        const mapping = {
            "1": 60,
            "5": 300,
            "15": 900,
            "30": 900,
            "60": 3600,
            "240": 21600
        };

        return mapping[String(interval)] || 300;
    }

    async function fetchCoinbaseCandles(marketKey, interval) {
        const market = CONFIG.markets[marketKey];

        if (!market || !market.coinbaseProduct) {
            throw new Error("Crypto data source is not configured.");
        }

        const granularity = getCoinbaseGranularity(interval);

        const url =
            "https://api.exchange.coinbase.com/products/" +
            encodeURIComponent(market.coinbaseProduct) +
            "/candles?granularity=" + granularity;

        const data = await fetchWithTimeout(url);

        if (!Array.isArray(data) || data.length < 30) {
            throw new Error(
                "Not enough candle data was returned by Coinbase."
            );
        }

        /*
         * Coinbase candle format:
         * [time, low, high, open, close, volume]
         *
         * Coinbase usually returns newest candles first.
         */
        const candles = data
            .map(function (row) {
                return {
                    time: Number(row[0]),
                    low: Number(row[1]),
                    high: Number(row[2]),
                    open: Number(row[3]),
                    close: Number(row[4]),
                    volume: Number(row[5] || 0)
                };
            })
            .filter(function (candle) {
                return (
                    Number.isFinite(candle.time) &&
                    Number.isFinite(candle.open) &&
                    Number.isFinite(candle.high) &&
                    Number.isFinite(candle.low) &&
                    Number.isFinite(candle.close) &&
                    candle.high >= candle.low
                );
            })
            .sort(function (a, b) {
                return a.time - b.time;
            });

        if (candles.length < 30) {
            throw new Error("Valid candle history is insufficient.");
        }

        return {
            candles: candles,
            source: "Coinbase Exchange public candles",
            marketLabel: market.coinbaseProduct
        };
    }

    /* ======================================================
       DATA PROVIDER: YAHOO FINANCE GOLD FUTURES
       ====================================================== */

    function getYahooInterval(interval) {
        const mapping = {
            "1": "1m",
            "5": "5m",
            "15": "15m",
            "30": "30m",
            "60": "60m",
            "240": "60m"
        };

        return mapping[String(interval)] || "5m";
    }

    function getYahooRange(interval) {
        if (interval === "1") {
            return "1d";
        }

        if (interval === "5" || interval === "15") {
            return "5d";
        }

        if (interval === "30" || interval === "60") {
            return "1mo";
        }

        return "3mo";
    }

    async function fetchGoldCandles(interval) {
        const symbol = CONFIG.markets.XAUUSD.yahooSymbol;

        const yahooInterval = getYahooInterval(interval);
        const range = getYahooRange(interval);

        const url =
            "https://query1.finance.yahoo.com/v8/finance/chart/" +
            encodeURIComponent(symbol) +
            "?interval=" + encodeURIComponent(yahooInterval) +
            "&range=" + encodeURIComponent(range);

        const data = await fetchWithTimeout(url);

        const result =
            data &&
            data.chart &&
            Array.isArray(data.chart.result)
                ? data.chart.result[0]
                : null;

        if (!result || !result.timestamp || !result.indicators) {
            throw new Error(
                "Gold market data is unavailable from this data provider."
            );
        }

        const quote =
            result.indicators.quote &&
            result.indicators.quote[0];

        if (!quote) {
            throw new Error("Gold candle information is missing.");
        }

        const candles = [];

        for (let i = 0; i < result.timestamp.length; i++) {
            const open = quote.open ? quote.open[i] : null;
            const high = quote.high ? quote.high[i] : null;
            const low = quote.low ? quote.low[i] : null;
            const close = quote.close ? quote.close[i] : null;
            const volume = quote.volume ? quote.volume[i] : 0;

            if (
                open === null ||
                high === null ||
                low === null ||
                close === null ||
                !Number.isFinite(Number(open)) ||
                !Number.isFinite(Number(high)) ||
                !Number.isFinite(Number(low)) ||
                !Number.isFinite(Number(close))
            ) {
                continue;
            }

            candles.push({
                time: Number(result.timestamp[i]),
                open: Number(open),
                high: Number(high),
                low: Number(low),
                close: Number(close),
                volume: Number(volume || 0)
            });
        }

        if (candles.length < 30) {
            throw new Error(
                "Not enough gold candle history was returned."
            );
        }

        return {
            candles: candles,
            source: "Yahoo Finance Gold Futures (GC=F)",
            marketLabel: "GC=F"
        };
    }

    /* ======================================================
       FETCH MARKET DATA
       ====================================================== */

    async function fetchMarketCandles(marketKey, interval) {
        const cacheKey = marketKey + "_" + interval;
        const cached = analysisCache.get(cacheKey);

        if (
            cached &&
            Date.now() - cached.timestamp < CONFIG.cacheDuration
        ) {
            return cached.value;
        }

        let result;

        if (marketKey === "BTCUSD" || marketKey === "ETHUSD") {
            result = await fetchCoinbaseCandles(marketKey, interval);
        } else if (marketKey === "XAUUSD") {
            result = await fetchGoldCandles(interval);
        } else {
            throw new Error("The selected market is not supported.");
        }

        result.candles = result.candles.slice(-250);

        analysisCache.set(cacheKey, {
            timestamp: Date.now(),
            value: result
        });

        return result;
    }

    /* ======================================================
       TECHNICAL INDICATORS
       ====================================================== */

    function calculateEMA(values, period) {
        if (values.length < period) {
            return null;
        }

        const multiplier = 2 / (period + 1);

        let ema = 0;

        for (let i = 0; i < period; i++) {
            ema += values[i];
        }

        ema /= period;

        for (let i = period; i < values.length; i++) {
            ema =
                (values[i] - ema) * multiplier +
                ema;
        }

        return ema;
    }

    function calculateRSI(values, period) {
        period = period || 14;

        if (values.length <= period) {
            return null;
        }

        let gains = 0;
        let losses = 0;

        for (let i = 1; i <= period; i++) {
            const difference = values[i] - values[i - 1];

            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }

        let averageGain = gains / period;
        let averageLoss = losses / period;

        for (let i = period + 1; i < values.length; i++) {
            const difference = values[i] - values[i - 1];

            const gain = Math.max(difference, 0);
            const loss = Math.max(-difference, 0);

            averageGain =
                (averageGain * (period - 1) + gain) / period;

            averageLoss =
                (averageLoss * (period - 1) + loss) / period;
        }

        if (averageLoss === 0) {
            return 100;
        }

        const rs = averageGain / averageLoss;

        return 100 - (100 / (1 + rs));
    }

    function calculateATR(candles, period) {
        period = period || 14;

        if (candles.length <= period) {
            return null;
        }

        const trueRanges = [];

        for (let i = 1; i < candles.length; i++) {
            const candle = candles[i];
            const previousClose = candles[i - 1].close;

            const tr = Math.max(
                candle.high - candle.low,
                Math.abs(candle.high - previousClose),
                Math.abs(candle.low - previousClose)
            );

            trueRanges.push(tr);
        }

        const selected = trueRanges.slice(-period);

        if (!selected.length) {
            return null;
        }

        return selected.reduce(function (sum, value) {
            return sum + value;
        }, 0) / selected.length;
    }

    function calculateAverageVolume(candles, period) {
        const selected = candles.slice(-period);

        if (!selected.length) {
            return 0;
        }

        return selected.reduce(function (sum, candle) {
            return sum + (Number(candle.volume) || 0);
        }, 0) / selected.length;
    }

    /* ======================================================
       PRICE STRUCTURE / SUPPORT / RESISTANCE
       ====================================================== */

    function calculateStructure(candles) {
        const recent = candles.slice(-21, -1);

        if (recent.length < 10) {
            return {
                direction: "Neutral",
                high: null,
                low: null,
                text: "Insufficient structure data"
            };
        }

        const previousHigh = Math.max.apply(
            null,
            recent.map(function (candle) {
                return candle.high;
            })
        );

        const previousLow = Math.min.apply(
            null,
            recent.map(function (candle) {
                return candle.low;
            })
        );

        const current = candles[candles.length - 1];

        let direction = "Neutral";
        let text = "Price remains inside the recent range.";

        if (current.close > previousHigh) {
            direction = "Bullish";
            text = "Price closed above the recent swing high.";
        } else if (current.close < previousLow) {
            direction = "Bearish";
            text = "Price closed below the recent swing low.";
        } else {
            const midpoint = (previousHigh + previousLow) / 2;

            if (current.close > midpoint) {
                direction = "Slightly bullish";
            } else if (current.close < midpoint) {
                direction = "Slightly bearish";
            }
        }

        return {
            direction: direction,
            high: previousHigh,
            low: previousLow,
            text: text
        };
    }

    function calculateSupportResistance(candles) {
        const recent = candles.slice(-30);

        const support = Math.min.apply(
            null,
            recent.map(function (candle) {
                return candle.low;
            })
        );

        const resistance = Math.max.apply(
            null,
            recent.map(function (candle) {
                return candle.high;
            })
        );

        return {
            support: support,
            resistance: resistance
        };
    }

    /* ======================================================
       CANDLE PATTERN DETECTION
       ====================================================== */

    function detectCandlePattern(candles) {
        const current = candles[candles.length - 1];
        const previous = candles[candles.length - 2];

        const body = Math.abs(current.close - current.open);

        const range = Math.max(
            current.high - current.low,
            Number.EPSILON
        );

        const upperWick =
            current.high - Math.max(current.open, current.close);

        const lowerWick =
            Math.min(current.open, current.close) - current.low;

        const previousBullish = previous.close > previous.open;
        const previousBearish = previous.close < previous.open;

        const currentBullish = current.close > current.open;
        const currentBearish = current.close < current.open;

        let pattern = "No clear reversal pattern";
        let direction = "Neutral";

        if (
            currentBullish &&
            previousBearish &&
            current.open <= previous.close &&
            current.close >= previous.open
        ) {
            pattern = "Bullish Engulfing";
            direction = "Bullish";

        } else if (
            currentBearish &&
            previousBullish &&
            current.open >= previous.close &&
            current.close <= previous.open
        ) {
            pattern = "Bearish Engulfing";
            direction = "Bearish";

        } else if (
            lowerWick > body * 2 &&
            upperWick < Math.max(body, range * 0.15) &&
            current.close > current.open
        ) {
            pattern = "Bullish Rejection Candle";
            direction = "Bullish";

        } else if (
            upperWick > body * 2 &&
            lowerWick < Math.max(body, range * 0.15) &&
            current.close < current.open
        ) {
            pattern = "Bearish Rejection Candle";
            direction = "Bearish";

        } else if (currentBullish && body / range > 0.7) {
            pattern = "Strong Bullish Candle";
            direction = "Bullish";

        } else if (currentBearish && body / range > 0.7) {
            pattern = "Strong Bearish Candle";
            direction = "Bearish";
        }

        return {
            pattern: pattern,
            direction: direction,
            body: body,
            range: range
        };
    }

    /* ======================================================
       ANALYSIS ENGINE
       ====================================================== */

    function analyzeCandles(candles) {
        if (!Array.isArray(candles) || candles.length < 30) {
            throw new Error(
                "Not enough market candles to analyze."
            );
        }

        const closes = candles.map(function (candle) {
            return candle.close;
        });

        const current = candles[candles.length - 1];
        const previous = candles[candles.length - 2];

        const ema9 = calculateEMA(closes, 9);
        const ema21 = calculateEMA(closes, 21);
        const ema50 = calculateEMA(closes, 50);

        const rsi = calculateRSI(closes, 14);
        const atr = calculateATR(candles, 14);

        const structure = calculateStructure(candles);
        const levels = calculateSupportResistance(candles);
        const pattern = detectCandlePattern(candles);

        const averageVolume = calculateAverageVolume(candles, 20);

        const lastVolume = Number(current.volume) || 0;

        let bullishScore = 0;
        let bearishScore = 0;

        const reasons = [];

        /* EMA trend */

        if (ema9 !== null && ema21 !== null) {
            if (ema9 > ema21) {
                bullishScore += 2;
                reasons.push("EMA 9 is above EMA 21.");
            } else if (ema9 < ema21) {
                bearishScore += 2;
                reasons.push("EMA 9 is below EMA 21.");
            }
        }

        if (ema21 !== null && ema50 !== null) {
            if (ema21 > ema50) {
                bullishScore += 2;
                reasons.push("EMA 21 is above EMA 50.");
            } else if (ema21 < ema50) {
                bearishScore += 2;
                reasons.push("EMA 21 is below EMA 50.");
            }
        }

        /* RSI momentum */

        if (rsi !== null) {
            if (rsi >= 52 && rsi <= 68) {
                bullishScore += 1;
                reasons.push("RSI supports bullish momentum.");
            } else if (rsi <= 48 && rsi >= 32) {
                bearishScore += 1;
                reasons.push("RSI supports bearish momentum.");
            } else if (rsi > 75) {
                reasons.push(
                    "RSI is high; buying may be overextended."
                );
            } else if (rsi < 25) {
                reasons.push(
                    "RSI is low; selling may be overextended."
                );
            }
        }

        /* Market structure */

        if (structure.direction === "Bullish") {
            bullishScore += 2;
            reasons.push("Recent candle broke above a swing high.");
        } else if (structure.direction === "Bearish") {
            bearishScore += 2;
            reasons.push("Recent candle broke below a swing low.");
        } else if (structure.direction === "Slightly bullish") {
            bullishScore += 1;
        } else if (structure.direction === "Slightly bearish") {
            bearishScore += 1;
        }

        /* Candle pattern */

        if (pattern.direction === "Bullish") {
            bullishScore += 1;
            reasons.push("Bullish candle confirmation detected.");
        } else if (pattern.direction === "Bearish") {
            bearishScore += 1;
            reasons.push("Bearish candle confirmation detected.");
        }

        /* Current candle momentum */

        if (current.close > previous.close) {
            bullishScore += 1;
        } else if (current.close < previous.close) {
            bearishScore += 1;
        }

        /* Volume confirmation when volume is available */

        if (
            averageVolume > 0 &&
            lastVolume > averageVolume * 1.3
        ) {
            if (current.close > current.open) {
                bullishScore += 1;
                reasons.push("Above-average volume on a bullish candle.");
            } else if (current.close < current.open) {
                bearishScore += 1;
                reasons.push("Above-average volume on a bearish candle.");
            }
        }

        /* Signal selection */

        let signal = "WAIT";
        let signalClass = "wait";

        const scoreDifference = bullishScore - bearishScore;

        /*
         * Require multiple pieces of agreement.
         * This is a technical rule, not a validated prediction model.
         */
        if (
            bullishScore >= 5 &&
            scoreDifference >= 2 &&
            !(rsi !== null && rsi > 75)
        ) {
            signal = "BUY";
            signalClass = "buy";

        } else if (
            bearishScore >= 5 &&
            scoreDifference <= -2 &&
            !(rsi !== null && rsi < 25)
        ) {
            signal = "SELL";
            signalClass = "sell";

        } else {
            reasons.push(
                "The available conditions do not agree strongly enough."
            );
        }

        /*
         * Risk management:
         * ATR is used for volatility-based protective levels.
         * Targets use a 1:1.5 and 1:2 risk/reward ratio.
         */
        const entry = current.close;

        const safeATR =
            atr && atr > 0
                ? atr
                : entry * 0.001;

        const stopDistance = safeATR * 1.5;

        let stopLoss;
        let takeProfit1;
        let takeProfit2;

        if (signal === "BUY") {
            stopLoss = entry - stopDistance;
            takeProfit1 = entry + stopDistance * 1.5;
            takeProfit2 = entry + stopDistance * 2;

        } else if (signal === "SELL") {
            stopLoss = entry + stopDistance;
            takeProfit1 = entry - stopDistance * 1.5;
            takeProfit2 = entry - stopDistance * 2;

        } else {
            /*
             * WAIT means there is no confirmed directional entry.
             * Do not present provisional prices as a trade setup.
             */
            stopLoss = null;
            takeProfit1 = null;
            takeProfit2 = null;
        }

        const maxScore = Math.max(bullishScore, bearishScore);
        const totalScore = bullishScore + bearishScore;

        let confidence = 0;

        if (signal !== "WAIT" && totalScore > 0) {
            confidence = Math.round(
                Math.min(
                    90,
                    50 + Math.abs(scoreDifference) * 5
                )
            );
        } else {
            confidence = Math.round(
                Math.min(
                    65,
                    35 + maxScore * 4
                )
            );
        }

        let trend = "Neutral";

        if (ema9 !== null && ema21 !== null && ema50 !== null) {
            if (ema9 > ema21 && ema21 > ema50) {
                trend = "Bullish";
            } else if (ema9 < ema21 && ema21 < ema50) {
                trend = "Bearish";
            }
        }

        return {
            signal: signal,
            signalClass: signalClass,
            entry: entry,
            stopLoss: stopLoss,
            takeProfit1: takeProfit1,
            takeProfit2: takeProfit2,
            confidence: confidence,
            trend: trend,
            rsi: rsi,
            ema9: ema9,
            ema21: ema21,
            ema50: ema50,
            atr: atr,
            structure: structure,
            support: levels.support,
            resistance: levels.resistance,
            candlePattern: pattern.pattern,
            bullishScore: bullishScore,
            bearishScore: bearishScore,
            reasons: reasons,
            candleTime: current.time
        };
    }

    /* ======================================================
       DISPLAY RESULTS
       ====================================================== */

    function renderAnalysis(result, dataInfo) {
        const container = $("naolAnalysisResult");

        if (!container) {
            return;
        }

        container.classList.add("visible");

        const signal = result.signal;

        let signalMessage = "";

        if (signal === "BUY") {
            signalMessage =
                "Bullish conditions are stronger in the analyzed data. " +
                "Confirm the price and spread with your broker before entry.";

        } else if (signal === "SELL") {
            signalMessage =
                "Bearish conditions are stronger in the analyzed data. " +
                "Confirm the price and spread with your broker before entry.";

        } else {
            signalMessage =
                "The strategy conditions are mixed or insufficient. " +
                "Waiting is safer than forcing a directional signal.";
        }

        const entryText = formatPrice(result.entry);

        const stopText =
            result.stopLoss === null
                ? "Not confirmed"
                : formatPrice(result.stopLoss);

        const tp1Text =
            result.takeProfit1 === null
                ? "Not confirmed"
                : formatPrice(result.takeProfit1);

        const tp2Text =
            result.takeProfit2 === null
                ? "Not confirmed"
                : formatPrice(result.takeProfit2);

        const rsiText =
            result.rsi === null
                ? "N/A"
                : formatNumber(result.rsi, 1);

        const atrText =
            result.atr === null
                ? "N/A"
                : formatPrice(result.atr);

        const supportText = formatPrice(result.support);
        const resistanceText = formatPrice(result.resistance);

        const emaText =
            result.ema9 === null || result.ema21 === null
                ? "N/A"
                : formatPrice(result.ema9) +
                  " / " +
                  formatPrice(result.ema21);

        const timeText = new Date(
            result.candleTime * 1000
        ).toLocaleString("en-GB", {
            timeZone: CONFIG.timezone,
            hour12: false
        });

        const reasonsHTML = result.reasons
            .slice(0, 7)
            .map(function (reason) {
                return "• " + escapeHTML(reason);
            })
            .join("<br>");

        container.innerHTML = `
            <div class="naol-analysis-signal ${result.signalClass}">
                <div class="naol-analysis-signal-label">
                    TECHNICAL SIGNAL
                </div>

                <div class="naol-analysis-signal-value">
                    ${escapeHTML(signal)}
                </div>

                <div class="naol-analysis-signal-note">
                    ${escapeHTML(signalMessage)}
                </div>
            </div>

            <div class="naol-analysis-grid">

                <div class="naol-analysis-metric">
                    <span>ENTRY REFERENCE</span>
                    <strong>${escapeHTML(entryText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>CONFIDENCE ESTIMATE</span>
                    <strong>${escapeHTML(String(result.confidence))}%</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>STOP LOSS</span>
                    <strong>${escapeHTML(stopText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>TAKE PROFIT 1</span>
                    <strong>${escapeHTML(tp1Text)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>TAKE PROFIT 2</span>
                    <strong>${escapeHTML(tp2Text)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>MARKET TREND</span>
                    <strong>${escapeHTML(result.trend)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>RSI (14)</span>
                    <strong>${escapeHTML(rsiText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>ATR VOLATILITY</span>
                    <strong>${escapeHTML(atrText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>EMA 9 / EMA 21</span>
                    <strong>${escapeHTML(emaText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>CANDLE PATTERN</span>
                    <strong>${escapeHTML(result.candlePattern)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>SUPPORT REFERENCE</span>
                    <strong>${escapeHTML(supportText)}</strong>
                </div>

                <div class="naol-analysis-metric">
                    <span>RESISTANCE REFERENCE</span>
                    <strong>${escapeHTML(resistanceText)}</strong>
                </div>

            </div>

            <div class="naol-analysis-reason">
                <strong>WHY THIS RESULT?</strong><br>
                ${reasonsHTML || "No additional confirmation."}
                <br><br>
                <strong>Structure:</strong>
                ${escapeHTML(result.structure.text)}
                <br>
                <strong>Bullish score:</strong>
                ${escapeHTML(String(result.bullishScore))}
                &nbsp; | &nbsp;
                <strong>Bearish score:</strong>
                ${escapeHTML(String(result.bearishScore))}
            </div>

            <div class="naol-analysis-source">
                Data source: ${escapeHTML(dataInfo.source)}<br>
                Data instrument: ${escapeHTML(dataInfo.marketLabel)}<br>
                Timeframe requested: ${escapeHTML(
                    getTimeframeLabel(activeInterval)
                )}<br>
                Latest candle timestamp:
                ${escapeHTML(timeText)}<br>
                Signal is based on the returned candles, not directly
                on the embedded TradingView chart or your Exness feed.
            </div>
        `;

        setAnalysisMessage(
            "Analysis completed. Check the data source and latest candle time."
        );
    }

    function renderAnalysisError(message) {
        const container = $("naolAnalysisResult");

        if (!container) {
            return;
        }

        container.classList.add("visible");

        container.innerHTML = `
            <div class="naol-analysis-error">
                <strong>Analysis could not be completed.</strong>
                <br><br>
                ${escapeHTML(message)}
                <br><br>
                Check your internet connection. If the problem continues,
                the data provider may be blocking browser requests or
                may be temporarily unavailable.
                <br><br>
                No BUY or SELL signal has been invented.
            </div>
        `;

        setAnalysisMessage("Market data unavailable.");
    }

    /* ======================================================
       MAIN ANALYSIS BUTTON
       ====================================================== */

    async function runAnalysis() {
        if (analysisRunning) {
            return;
        }

        analysisRunning = true;

        setAnalysisLoading(true);

        setAnalysisMessage(
            "Connecting to the market data source..."
        );

        const resultContainer = $("naolAnalysisResult");

        if (resultContainer) {
            resultContainer.classList.add("visible");
            resultContainer.innerHTML = `
                <div class="naol-analysis-signal wait">
                    <div class="naol-analysis-signal-label">
                        PLEASE WAIT
                    </div>

                    <div class="naol-analysis-signal-value">
                        ANALYZING...
                    </div>

                    <div class="naol-analysis-signal-note">
                        Retrieving candle data and calculating indicators.
                    </div>
                </div>
            `;
        }

        const marketAtStart = activeMarket;
        const intervalAtStart = activeInterval;

        try {
            const dataInfo = await fetchMarketCandles(
                marketAtStart,
                intervalAtStart
            );

            /*
             * Avoid showing a result for a market the user changed
             * while the request was running.
             */
            if (
                marketAtStart !== activeMarket ||
                intervalAtStart !== activeInterval
            ) {
                throw new Error(
                    "Market or timeframe changed during analysis. Press Analyze Market again."
                );
            }

            const analysis = analyzeCandles(dataInfo.candles);

            lastAnalysis = {
                market: marketAtStart,
                timeframe: intervalAtStart,
                result: analysis,
                timestamp: Date.now()
            };

            renderAnalysis(analysis, dataInfo);

        } catch (error) {
            console.error("Naol market analysis error:", error);

            renderAnalysisError(
                error && error.message
                    ? error.message
                    : "Unknown error while retrieving market data."
            );

        } finally {
            analysisRunning = false;
            setAnalysisLoading(false);
        }
    }

    /* ======================================================
       EVENT LISTENERS
       ====================================================== */

    marketButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            const marketKey = button.dataset.name;

            if (!CONFIG.markets[marketKey]) {
                return;
            }

            updateMarketDisplay(marketKey);

            /*
             * Reload chart immediately. Analysis only runs when
             * the user presses ANALYZE MARKET.
             */
            loadChart();

            setAnalysisMessage(
                "Market changed to " + marketKey +
                ". Press Analyze Market to run a new analysis."
            );
        });
    });

    timeframeButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            const interval = String(button.dataset.interval);

            const allowedIntervals = [
                "1",
                "5",
                "15",
                "30",
                "60",
                "240"
            ];

            if (!allowedIntervals.includes(interval)) {
                return;
            }

            updateTimeframeDisplay(interval);

            loadChart();

            setAnalysisMessage(
                "Timeframe changed to " +
                getTimeframeLabel(interval) +
                ". Press Analyze Market to run a new analysis."
            );
        });
    });

    /* ======================================================
       INITIALIZE
       ====================================================== */

    if (currentYear) {
        currentYear.textContent = String(
            new Date().getFullYear()
        );
    }

    updateMarketDisplay("XAUUSD");
    updateTimeframeDisplay("5");

    installAnalysisPanel();

    if (!chartContainer) {
        setStatus("Chart container missing");

        console.error(
            "Add the tradingview_chart element to index.html."
        );
    } else {
        loadChart();
    }

    /*
     * Optional debugging interface.
     * This does not expose API keys because none are stored here.
     */
    window.NaolFXAnalyzer = {
        getActiveMarket: function () {
            return activeMarket;
        },

        getActiveTimeframe: function () {
            return activeInterval;
        },

        getLastAnalysis: function () {
            return lastAnalysis;
        },

        reloadChart: function () {
            loadChart();
        },

        analyze: function () {
            return runAnalysis();
        }
    };

});
