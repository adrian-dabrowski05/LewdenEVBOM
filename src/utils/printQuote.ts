import type { Product, QuoteFormData } from '../types'

interface PrintItem {
  description: string
  part_number: string | null
  factory_cost: number | null
  quantity: number
  line_total: number | null
}

interface PrintQuoteOptions {
  form: QuoteFormData
  items: PrintItem[]
  products: Product[]
  materialsSubtotal: number
  hardwareUpliftPct: number
  hardwareUpliftAmount: number
  labourMinutes: number
  labourRatePerMin: number
  labourTotal: number
  grandTotal: number
  baseUrl: string
}

export function printQuote(opts: PrintQuoteOptions) {
  const {
    form, items, materialsSubtotal,
    hardwareUpliftPct, hardwareUpliftAmount,
    labourMinutes, labourRatePerMin, labourTotal,
    grandTotal, baseUrl,
  } = opts

  const fmt = (n: number | null) => n != null ? `£${n.toFixed(2)}` : '—'
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const ref = `LWD-${Date.now().toString(36).toUpperCase().slice(-6)}`

  const itemRows = items.map((item) => `
    <tr>
      <td>${item.description}</td>
      <td class="mono">${item.part_number ?? '—'}</td>
      <td class="right">${item.factory_cost != null ? fmt(item.factory_cost) : '<span class="tbc">TBC</span>'}</td>
      <td class="right center">${item.quantity}</td>
      <td class="right bold">${item.line_total != null ? fmt(item.line_total) : '<span class="tbc">TBC</span>'}</td>
    </tr>
  `).join('')

  const labourRow = labourTotal > 0 ? `
    <tr class="summary-row">
      <td colspan="4" class="right label">Labour (${labourMinutes} min @ £${labourRatePerMin.toFixed(4)}/min)</td>
      <td class="right">£${labourTotal.toFixed(2)}</td>
    </tr>
  ` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quote — ${form.project_name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11pt;
      color: #0f1117;
      background: #fff;
      padding: 0;
    }
    .page { max-width: 210mm; margin: 0 auto; padding: 16mm 16mm 12mm; }

    /* Header */
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #004A9A; }
    .logo-area img { height: 48px; }
    .logo-fallback { font-size: 22pt; font-weight: 700; color: #004A9A; letter-spacing: -0.5px; }
    .doc-title { text-align: right; }
    .doc-title h1 { font-size: 18pt; font-weight: 700; color: #004A9A; margin-bottom: 4px; }
    .doc-title .ref { font-size: 9pt; color: #6b7280; }
    .doc-title .date { font-size: 9pt; color: #6b7280; }

    /* Meta */
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .meta-box { background: #f4f5f7; border-radius: 6px; padding: 10px 14px; }
    .meta-box .label { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3b0; margin-bottom: 4px; }
    .meta-box .value { font-size: 11pt; font-weight: 500; }
    .meta-box .sub { font-size: 9pt; color: #5c6070; margin-top: 2px; }

    /* Notes */
    .notes { background: #fffbe6; border-left: 3px solid #FFCC00; padding: 8px 12px; margin-bottom: 20px; font-size: 10pt; color: #5c4200; border-radius: 0 4px 4px 0; }

    /* Table */
    table { width: 100%; border-collapse: collapse; margin-bottom: 0; font-size: 10pt; }
    thead tr { background: #004A9A; color: #fff; }
    thead th { padding: 8px 10px; text-align: left; font-size: 8.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    thead th.right { text-align: right; }
    tbody tr { border-bottom: 1px solid #eceef2; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    tbody td { padding: 7px 10px; vertical-align: middle; }
    td.right { text-align: right; }
    td.center { text-align: center; }
    td.mono { font-family: 'Courier New', monospace; font-size: 9pt; color: #6b7280; background: #f4f5f7; border-radius: 3px; padding: 2px 6px; }
    td.bold { font-weight: 600; }
    .tbc { color: #9ca3b0; font-style: italic; }

    /* Summary rows */
    .summary-section { border-top: 1.5px solid #eceef2; }
    tr.summary-row td { padding: 5px 10px; background: #f9fafb; font-size: 10pt; }
    tr.summary-row td.label { color: #5c6070; }
    tr.uplift-row td { background: #fffbe6; color: #5c4200; }
    tr.labour-row td { background: #eef4ff; color: #003578; }
    tr.total-row td { background: #004A9A; color: #fff; font-size: 13pt; font-weight: 700; padding: 10px; }
    tr.total-row td.right { text-align: right; }

    /* Footer */
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #eceef2; display: flex; justify-content: space-between; font-size: 8.5pt; color: #9ca3b0; }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .page { padding: 10mm 12mm; }
      @page { size: A4; margin: 0; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="logo-area">
      <img src="${baseUrl}logo.png" alt="Lewden" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <div class="logo-fallback" style="display:none">Lewden</div>
    </div>
    <div class="doc-title">
      <h1>EV Pillar Quotation</h1>
      <div class="ref">Ref: ${ref}</div>
      <div class="date">Date: ${date}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="label">Project</div>
      <div class="value">${form.project_name || '—'}</div>
    </div>
    <div class="meta-box">
      <div class="label">Customer</div>
      <div class="value">${form.customer_name || '—'}</div>
    </div>
  </div>

  ${form.notes ? `<div class="notes">${form.notes}</div>` : ''}

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Part no.</th>
        <th class="right">Unit cost</th>
        <th class="right">Qty</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tbody class="summary-section">
      <tr class="summary-row">
        <td colspan="4" class="right label">Materials subtotal</td>
        <td class="right">£${materialsSubtotal.toFixed(2)}</td>
      </tr>
      ${hardwareUpliftAmount > 0 ? `
      <tr class="summary-row uplift-row">
        <td colspan="4" class="right label">Hardware uplift (${hardwareUpliftPct}%)</td>
        <td class="right">£${hardwareUpliftAmount.toFixed(2)}</td>
      </tr>` : ''}
      ${labourRow}
      <tr class="total-row">
        <td colspan="4" class="right">Grand total</td>
        <td class="right">£${grandTotal.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <div>Lewden · EV Pillar Quotation Tool</div>
    <div>Generated ${date}</div>
  </div>

</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`

  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) { alert('Please allow pop-ups to generate the PDF'); return }
  win.document.write(html)
  win.document.close()
}
