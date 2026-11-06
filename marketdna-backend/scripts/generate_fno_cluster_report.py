"""
F&O Universe — Return-Profile Clustering Report.

Takes every F&O underlying symbol (marketdna-data/FO.csv, ~209 names) and builds
a 5-dimensional feature vector per symbol from gap-inclusive close-to-close
returns across timeframes: 1-Day, 5-Day, 1-Month (20d), 3-Month (60d), 1-Year
(252d) — the same timeframe set used in the daily FNO_Returns_Report tiles.
Pure DuckDB-over-parquet, no backend/live data needed.

Pipeline (deterministic — random_state=42 throughout, per CLAUDE.md Core
Principle 3):
  1. Standardize the 5 return features (StandardScaler).
  2. PCA on the standardized features (up to 5 components) — report explained
     variance, use PC1/PC2 for the scatter, inspect loadings to see which
     timeframe drives which axis.
  3. K-Means on the standardized features (not the PCA projection, to use the
     full signal) with k swept 3..7 and the best k picked by silhouette score.
  4. Clusters are relabeled A, B, C... in descending order of mean 1-Year
     return, so "Cluster A" is always the strongest-momentum group regardless
     of KMeans' arbitrary internal label order.

Output: reports/FNO_Cluster_Analysis_<date>.pdf

Run (from marketdna-backend/, with venv active):
  .\\.venv\\Scripts\\python.exe scripts\\generate_fno_cluster_report.py
"""
import os
import sys
import datetime as dt

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, PageBreak,
)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
REPO = os.path.dirname(BACKEND_DIR)
REPORTS_DIR = os.path.join(BACKEND_DIR, "reports")
CHART_DIR = os.path.join(REPORTS_DIR, ".cache", "cluster_charts")
os.makedirs(CHART_DIR, exist_ok=True)

# Core analysis (symbols/prices/PCA/K-Means) lives in app/services/fno_cluster_service.py
# — the same module the live /clusters page's API reads from — so the PDF and the
# page can never drift apart. Only PDF/chart rendering stays local to this script.
sys.path.insert(0, BACKEND_DIR)
from app.services import fno_cluster_service as svc  # noqa: E402

FEATURE_COLS = svc.FEATURE_COLS
load_symbols = svc.load_symbols
load_prices = svc.load_prices
build_feature_table = svc.build_feature_table
run_analysis = svc.run_analysis
characterize = svc.characterize

GREEN = colors.HexColor("#1a9850")
RED = colors.HexColor("#d73027")
INK = colors.HexColor("#111827")
INK2 = colors.HexColor("#374151")
INK3 = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#d1d5db")
PAPER2 = colors.HexColor("#f3f4f6")


# ------------------------------------------------------------------ charts --

def fmt_ret(v):
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.2f}%"


def chart_diagnostics(diag: pd.DataFrame, best_k: int) -> str:
    path = os.path.join(CHART_DIR, "diagnostics.png")
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.4, 2.9), dpi=150)
    ax1.plot(diag["k"], diag["inertia"], marker="o", color="#374151", linewidth=1.4)
    ax1.axvline(best_k, color="#1d4ed8", linestyle="--", linewidth=1)
    ax1.set_title("Elbow: Inertia vs k", fontsize=8)
    ax1.set_xlabel("k", fontsize=7)
    ax1.tick_params(labelsize=6.5)

    ax2.plot(diag["k"], diag["silhouette"], marker="o", color="#1a9850", linewidth=1.4)
    ax2.axvline(best_k, color="#1d4ed8", linestyle="--", linewidth=1)
    ax2.set_title(f"Silhouette vs k (chosen k={best_k})", fontsize=8)
    ax2.set_xlabel("k", fontsize=7)
    ax2.tick_params(labelsize=6.5)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


CLUSTER_PALETTE = ["#1d4ed8", "#d73027", "#1a9850", "#f59e0b", "#7c3aed", "#0891b2", "#be185d"]


def chart_pca_scatter(feat: pd.DataFrame, pca: PCA) -> str:
    path = os.path.join(CHART_DIR, "pca_scatter.png")
    fig, ax = plt.subplots(figsize=(7.4, 5.4), dpi=150)
    clusters = sorted(feat["cluster"].unique())
    for i, c in enumerate(clusters):
        sub = feat[feat["cluster"] == c]
        ax.scatter(
            sub["PC1"], sub["PC2"],
            s=16, alpha=0.75, color=CLUSTER_PALETTE[i % len(CLUSTER_PALETTE)],
            label=f"{c}  (n={len(sub)})", edgecolors="none",
        )
    var1, var2 = pca.explained_variance_ratio_[0] * 100, pca.explained_variance_ratio_[1] * 100
    ax.set_xlabel(f"PC1 ({var1:.1f}% variance)", fontsize=9)
    ax.set_ylabel(f"PC2 ({var2:.1f}% variance)", fontsize=9)
    ax.axhline(0, color="#d1d5db", linewidth=0.6)
    ax.axvline(0, color="#d1d5db", linewidth=0.6)
    ax.legend(fontsize=7.5, loc="best", framealpha=0.9)
    ax.set_title("F&O Universe — PCA Projection of Return Profiles, Colored by Cluster", fontsize=9.5)
    ax.tick_params(labelsize=7.5)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


def chart_loadings(pca: PCA) -> str:
    path = os.path.join(CHART_DIR, "loadings.png")
    loadings = pca.components_[:2]  # PC1, PC2 x 5 features
    x = np.arange(len(FEATURE_COLS))
    width = 0.35
    fig, ax = plt.subplots(figsize=(7.4, 3.0), dpi=150)
    ax.bar(x - width / 2, loadings[0], width, label="PC1", color="#1d4ed8")
    ax.bar(x + width / 2, loadings[1], width, label="PC2", color="#d73027")
    ax.axhline(0, color="#9ca3af", linewidth=0.7)
    ax.set_xticks(x)
    ax.set_xticklabels(FEATURE_COLS, fontsize=8)
    ax.set_title("PCA Loadings — Contribution of Each Timeframe Return to PC1 / PC2", fontsize=9)
    ax.legend(fontsize=8)
    ax.tick_params(labelsize=7.5)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


def chart_cluster_heatmap(feat: pd.DataFrame) -> str:
    path = os.path.join(CHART_DIR, "cluster_heatmap.png")
    clusters = sorted(feat["cluster"].unique())
    mat = feat.groupby("cluster")[FEATURE_COLS].mean().reindex(clusters).to_numpy()
    fig, ax = plt.subplots(figsize=(6.6, 0.55 * len(clusters) + 1.0), dpi=150)
    vmax = np.max(np.abs(mat))
    im = ax.imshow(mat, cmap="RdYlGn", vmin=-vmax, vmax=vmax, aspect="auto")
    ax.set_xticks(np.arange(len(FEATURE_COLS)))
    ax.set_xticklabels(FEATURE_COLS, fontsize=8)
    ax.set_yticks(np.arange(len(clusters)))
    ax.set_yticklabels(clusters, fontsize=8)
    for i in range(mat.shape[0]):
        for j in range(mat.shape[1]):
            ax.text(j, i, f"{mat[i, j]:+.1f}%", ha="center", va="center", fontsize=7.5, color="#111827")
    ax.set_title("Mean Return per Cluster by Timeframe", fontsize=9.5)
    fig.colorbar(im, ax=ax, fraction=0.04, pad=0.03)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path


# -------------------------------------------------------------------- PDF --

def ret_cell(v, style_pos, style_neg, style_zero):
    if v > 0:
        return Paragraph(fmt_ret(v), style_pos)
    if v < 0:
        return Paragraph(fmt_ret(v), style_neg)
    return Paragraph(fmt_ret(v), style_zero)


def build_pdf(feat: pd.DataFrame, pca: PCA, best_k: int, sil: float, diag: pd.DataFrame,
              as_of: str, excluded: int, out_path: str):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("t", parent=styles["Title"], fontSize=18, spaceAfter=4)
    sub_style = ParagraphStyle("sub", parent=styles["Normal"], fontSize=10, textColor=INK3, spaceAfter=14)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=13, spaceBefore=10, spaceAfter=6, textColor=INK)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9.3, leading=13.5, textColor=INK2)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, textColor=INK3, leading=11.5)

    th_style = ParagraphStyle("th", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.6, textColor=INK)
    sym_style = ParagraphStyle("sym", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=INK)
    pos_style = ParagraphStyle("pos", parent=styles["Normal"], fontSize=8, textColor=GREEN)
    neg_style = ParagraphStyle("neg", parent=styles["Normal"], fontSize=8, textColor=RED)
    zero_style = ParagraphStyle("zero", parent=styles["Normal"], fontSize=8, textColor=INK3)
    note_style = ParagraphStyle("note", parent=styles["Normal"], fontSize=7.8, textColor=INK2)

    story = []

    # ---- Page 1: title + methodology ----
    story.append(Paragraph("F&amp;O Universe — Return-Profile Clustering", title_style))
    story.append(Paragraph(
        f"PCA + K-Means over {len(feat)} symbols &middot; data as of {as_of} &middot; "
        f"generated {dt.date.today().isoformat()}", sub_style
    ))
    story.append(Paragraph("Methodology", h2))
    story.append(Paragraph(
        "Each symbol is reduced to a 5-dimensional feature vector of gap-inclusive, "
        "close-to-close % returns across five timeframes — 1-Day, 5-Day, 1-Month (20 "
        "trading days), 3-Month (60 trading days) and 1-Year (252 trading days) — the "
        "same timeframe set used in the daily FNO Returns Report tiles. Features are "
        "standardized (zero mean, unit variance) before any unsupervised step, since "
        "1-Day and 1-Year returns live on very different scales.", body
    ))
    story.append(Paragraph(
        "<b>PCA</b> is fit on the standardized features to find the directions of "
        "greatest variance across the universe; the first two components (PC1, PC2) "
        "are used for the 2-D scatter on the next page. <b>K-Means</b> is fit "
        "separately on the full standardized feature space (not the PCA projection, "
        "so no signal is discarded) with k swept from 3 to 7 and the winner chosen by "
        "silhouette score — a measure of how well-separated and internally cohesive "
        "the resulting clusters are (closer to +1 is better). All steps use "
        "random_state=42 for full reproducibility.", body
    ))
    story.append(Paragraph(
        f"Chosen k = <b>{best_k}</b> clusters, silhouette score = <b>{sil:.3f}</b>. "
        f"{excluded} symbol(s) were excluded for insufficient 1-year price history.",
        body
    ))
    story.append(Paragraph(
        "Clusters are relabeled A, B, C… in descending order of mean 1-Year return, "
        "so Cluster A is always the strongest long-term-momentum group and the last "
        "letter is always the weakest, regardless of K-Means' internal (arbitrary) "
        "label numbering.", body
    ))
    story.append(PageBreak())

    # ---- Page 2: diagnostics ----
    story.append(Paragraph("Choosing k — Elbow & Silhouette Diagnostics", h2))
    story.append(Image(chart_diagnostics(diag, best_k), width=174 * mm, height=174 * mm * (2.9 / 7.4)))
    story.append(Spacer(1, 6))
    diag_rows = [[Paragraph("k", th_style), Paragraph("Inertia", th_style), Paragraph("Silhouette", th_style)]]
    for _, r in diag.iterrows():
        marker = "  &larr; chosen" if int(r["k"]) == best_k else ""
        diag_rows.append([
            Paragraph(f"{int(r['k'])}{marker}", note_style),
            Paragraph(f"{r['inertia']:.1f}", note_style),
            Paragraph(f"{r['silhouette']:.3f}", note_style),
        ])
    t = Table(diag_rows, colWidths=[40 * mm, 60 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), PAPER2),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ---- Page 3: PCA scatter ----
    story.append(Paragraph("PCA Projection", h2))
    story.append(Image(chart_pca_scatter(feat, pca), width=174 * mm, height=174 * mm * (5.4 / 7.4)))
    story.append(PageBreak())

    # ---- Page 4: loadings ----
    story.append(Paragraph("PCA Loadings — What Drives Each Axis", h2))
    story.append(Image(chart_loadings(pca), width=174 * mm, height=174 * mm * (3.0 / 7.4)))
    top_pc1 = FEATURE_COLS[int(np.argmax(np.abs(pca.components_[0])))]
    top_pc2 = FEATURE_COLS[int(np.argmax(np.abs(pca.components_[1])))]
    story.append(Paragraph(
        f"PC1 is driven most strongly by the <b>{top_pc1}</b> return, PC2 by the "
        f"<b>{top_pc2}</b> return. A loading's sign shows direction: a feature with "
        f"the same sign as another on a given PC moves together on that axis; "
        f"opposite signs move against each other.", small
    ))
    story.append(PageBreak())

    # ---- Page 5: cluster summary ----
    story.append(Paragraph("Cluster Summary", h2))
    story.append(Image(chart_cluster_heatmap(feat), width=140 * mm, height=140 * mm * 0.6))
    story.append(Spacer(1, 8))
    clusters = sorted(feat["cluster"].unique())
    summary_rows = [[
        Paragraph("Cluster", th_style), Paragraph("n", th_style),
        Paragraph("1D", th_style), Paragraph("5D", th_style), Paragraph("1M", th_style),
        Paragraph("3M", th_style), Paragraph("1Y", th_style), Paragraph("Character", th_style),
    ]]
    for c in clusters:
        sub = feat[feat["cluster"] == c]
        means = sub[FEATURE_COLS].mean()
        rep_row = means.to_dict()
        rep_row_full = {**rep_row}
        char = characterize(rep_row_full)
        row = [Paragraph(f"<b>{c}</b>", sym_style), Paragraph(str(len(sub)), note_style)]
        for tf in FEATURE_COLS:
            row.append(ret_cell(means[tf], pos_style, neg_style, zero_style))
        row.append(Paragraph(char, note_style))
        summary_rows.append(row)
    t = Table(summary_rows, colWidths=[18 * mm, 10 * mm, 16 * mm, 16 * mm, 16 * mm, 16 * mm, 16 * mm, 66 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), PAPER2),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ---- Pages 6+: per-cluster symbol listing ----
    for c in clusters:
        sub = feat[feat["cluster"] == c].sort_values("1Y", ascending=False)
        means = sub[FEATURE_COLS].mean()
        char = characterize(means.to_dict())
        story.append(Paragraph(
            f"Cluster {c} &mdash; {len(sub)} symbols &mdash; {char}", h2
        ))
        rows = [[
            Paragraph("Symbol", th_style), Paragraph("1D", th_style), Paragraph("5D", th_style),
            Paragraph("1M", th_style), Paragraph("3M", th_style), Paragraph("1Y", th_style),
            Paragraph("PC1", th_style), Paragraph("PC2", th_style),
        ]]
        for _, r in sub.iterrows():
            sym = r["symbol"].replace("&", "&amp;")
            row = [Paragraph(sym, sym_style)]
            for tf in FEATURE_COLS:
                row.append(ret_cell(r[tf], pos_style, neg_style, zero_style))
            row.append(Paragraph(f"{r['PC1']:.2f}", note_style))
            row.append(Paragraph(f"{r['PC2']:.2f}", note_style))
            rows.append(row)
        t = Table(rows, colWidths=[28 * mm, 20 * mm, 20 * mm, 20 * mm, 20 * mm, 20 * mm, 18 * mm, 18 * mm], repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.3, BORDER),
            ("BACKGROUND", (0, 0), (-1, 0), PAPER2),
            ("TOPPADDING", (0, 0), (-1, -1), 2.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ]))
        story.append(t)
        story.append(PageBreak())

    story.pop()  # drop trailing page break

    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=14 * mm,
        title="F&O Cluster Analysis",
    )
    doc.build(story)


def main():
    print("Loading F&O symbol list...")
    symbols = load_symbols()
    print(f"{len(symbols)} symbols")

    print("Querying DuckDB for EOD price history...")
    prices = load_prices(symbols)
    print(f"{len(prices)} rows fetched")

    feat = build_feature_table(prices)
    excluded = len(symbols) - len(feat)
    print(f"{len(feat)} symbols with full return history ({excluded} excluded)")

    as_of = feat["as_of_date"].max() if len(feat) else dt.date.today().isoformat()

    print("Running PCA + K-Means...")
    feat, pca, best_k, sil, diag, scaler = run_analysis(feat)
    print(f"Chosen k={best_k}, silhouette={sil:.3f}")

    out_path = os.path.join(REPORTS_DIR, f"FNO_Cluster_Analysis_{as_of}.pdf")
    build_pdf(feat, pca, best_k, sil, diag, as_of, excluded, out_path)
    print(f"PDF written to {out_path}")


if __name__ == "__main__":
    main()
