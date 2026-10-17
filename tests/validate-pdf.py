"""Validação opcional de artefatos reais: python3 -m pip install pymupdf; python3 tests/validate-pdf.py."""
import calendar
import json
import pathlib
import pymupdf
from datetime import datetime, timezone

root = pathlib.Path(__file__).resolve().parent.parent
context = json.loads((root / '.test-data/context.json').read_text())
year, month = map(int, context['prior'].split('-'))
expected = [f'{d:02d}/{month:02d}/{year}' for d in range(1, calendar.monthrange(year, month)[1] + 1)]
files = ['test-results/folha-teste.pdf', 'test-results/pdf-observacoes-longas.pdf', 'test-results/browser/download-folha.pdf', 'test-results/browser/impressao-a4.pdf']
results = []
for filename in files:
    doc = pymupdf.open(root / filename)
    text = '\n'.join(page.get_text() for page in doc)
    overflow = []
    for page_no, page in enumerate(doc):
        assert abs(page.rect.width - 841.89) < 2 and abs(page.rect.height - 595.28) < 2, filename
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    x0, y0, x1, y1 = span['bbox']
                    if min(x0, y0) < -.1 or x1 > page.rect.width + .1 or y1 > page.rect.height + .1:
                        overflow.append({'page': page_no + 1, 'text': span['text']})
    assert not overflow, (filename, overflow)
    dates_to_check = [date[:5] for date in expected] if 'impressao-a4' in filename else expected
    assert all(date in text for date in dates_to_check) and str(year) in text, filename + ': faltam datas'
    assert 'Assinatura' in text, filename + ': faltam assinaturas'
    assert 'Faltantes' in text, filename + ': faltam totais'
    if 'longas' in filename:
        assert 'MARCADOR-FINAL-OBSERVACAO' in text, 'Fim da observação extensa ausente'
        assert 'Registros originais' in text, 'Rastreabilidade do ajuste ausente'
        assert '-224:00' in text, 'Sinal do saldo negativo deve ser legível'
        doc[-1].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(root / 'test-results/pdf-anexo-validado.png')
        doc[1].get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2)).save(root / 'test-results/pdf-resumo-validado.png')
    results.append({'file': filename, 'status': 'PASS', 'pages': len(doc), 'a4_landscape': True, 'all_month_dates': True, 'no_text_outside_page': True, 'signatures_and_totals': True, 'long_note_complete': 'MARCADOR-FINAL-OBSERVACAO' in text})
output = {'date': datetime.now(timezone.utc).isoformat(), 'month': context['prior'], 'tool': 'PyMuPDF', 'results': results}
(root / 'test-results/pdf-validation.json').write_text(json.dumps(output, ensure_ascii=False, indent=2))
print(f'{len(results)} PDFs reais aprovados: A4, datas, totais, assinaturas e limites da página; anexo longo integral.')
