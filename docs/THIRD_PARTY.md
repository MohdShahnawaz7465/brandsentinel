# Third-party software and services

| Item | Version | Licence | Used for | How it is loaded |
|---|---|---|---|---|
| JSZip | 3.10.1 (browser), ^3.10.2 (tests) | MIT or GPL-3.0 | Reading Word (.docx) files | Script from cdnjs; npm for tests |
| pdf.js | 3.11.174 | Apache-2.0 | Reading text from PDFs | Script from cdnjs, on first PDF |
| tesseract.js | 5.1.1 | Apache-2.0 | OCR for scanned PDFs and pictures (English language data is downloaded by the library) | Script from jsDelivr, on first use |
| DM Sans, DM Mono | Google Fonts | SIL Open Font Licence | Interface fonts | Google Fonts stylesheet |
| FastAPI | 0.161.0 | MIT | Backend web framework | pip |
| Starlette | 1.9.0 | BSD-3-Clause | Used by FastAPI | pip |
| Pydantic | 2.13.4 | MIT | Request validation | pip |
| uvicorn | 0.54.0 | BSD-3-Clause | Local backend server | pip |
| httpx | 0.28.1 | BSD-3-Clause | Calls from the backend to the AI provider | pip |
| psycopg (binary) | 3.2 to <4 | LGPL-3.0 | Postgres driver | pip |
| Python standard library | 3.12 | PSF | PBKDF2 password hashing, HMAC tokens, SQLite for tests | - |
| Groq API, model `openai/gpt-oss-20b` | - | Model weights: Apache-2.0; service: Groq terms | The AI step | Called only from the backend |
| Vercel | - | Hosting service | Frontend and backend hosting | - |
| Neon | - | Database service | Postgres database | Through the Vercel integration |

The brand "Tidewell", its approved facts, rules and sample drafts were made up for the demo. The project was built with the help of an AI coding assistant (Claude).

Versions are those pinned in `backend/requirements.txt`, `package.json` and the script addresses in `build.js` and `src/app.js`. Licence names are taken from each project's published licence and should be re-checked before any commercial use.