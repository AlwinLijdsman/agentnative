# Azure Document Intelligence

Document analysis, OCR, and structured data extraction.

## Scope

- Analyze documents (PDF, images, Office files)
- Extract text, tables, key-value pairs
- Pre-built models for invoices, receipts, IDs
- Custom trained models for domain-specific documents

## Guidelines

- Auth: `Ocp-Apim-Subscription-Key` header
- API version required: `?api-version=2024-11-30`
- Document analysis is async: submit with POST, poll for results with GET
- Pre-built models: `prebuilt-layout`, `prebuilt-invoice`, `prebuilt-receipt`, `prebuilt-idDocument`
- Max file size: 500MB for PDF, 50MB for images

## API Reference

### GET /formrecognizer/documentModels?api-version=2024-11-30
List available document models.

### POST /formrecognizer/documentModels/{model}:analyze?api-version=2024-11-30
Start document analysis.

**Headers:**
- `Content-Type`: `application/pdf`, `image/jpeg`, `image/png`, or `application/json`

**Body:** Raw file bytes or `{"urlSource": "https://..."}`

**Response:** `Operation-Location` header with URL to poll for results.

### GET {Operation-Location}
Poll for analysis results (returns 200 when complete).
