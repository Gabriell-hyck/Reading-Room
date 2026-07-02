import React, { useState, useEffect, useCallback } from "react";
import { Search, ArrowLeft, ChevronDown, X } from "lucide-react";

const GENRES = [
  "All",
  "Fiction",
  "Romance",
  "Adventure",
  "Mystery",
  "Gothic Fiction",
  "Fantasy",
  "Horror",
  "Science Fiction",
  "Philosophy",
  "Poetry",
  "Drama",
  "History",
];

function stripBoilerplate(text) {
  const startRe = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i;
  const endRe = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i;
  let start = 0;
  let end = text.length;
  const sMatch = text.match(startRe);
  if (sMatch) start = sMatch.index + sMatch[0].length;
  const eMatch = text.match(endRe);
  if (eMatch) end = eMatch.index;
  return text.slice(start, end).trim();
}

function splitChapters(text) {
  const lines = text.split("\n");
  const headingRe = /^(chapter|part|book|volume)\s+([ivxlcdm]+|\d+)\b/i;
  const headingIdx = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 60 && headingRe.test(trimmed)) {
      headingIdx.push(i);
    }
  });

  const chapters = [];
  if (headingIdx.length >= 2) {
    for (let i = 0; i < headingIdx.length; i++) {
      const start = headingIdx[i];
      const end = i + 1 < headingIdx.length ? headingIdx[i + 1] : lines.length;
      const title = lines[start].trim();
      const body = lines.slice(start + 1, end).join("\n").trim();
      if (body.length > 0) chapters.push({ title, body });
    }
  }

  if (chapters.length === 0) {
    const words = text.split(/\s+/);
    const chunkSize = 2500;
    let idx = 0;
    let part = 1;
    while (idx < words.length) {
      const chunk = words.slice(idx, idx + chunkSize).join(" ");
      chapters.push({ title: `Part ${part}`, body: chunk });
      idx += chunkSize;
      part += 1;
    }
  }
  return chapters;
}

async function fetchTextWithFallback(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  const mirrors = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://r.jina.ai/${url}`
  ];

  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, { 
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 500) return text;
      }
    } catch (e) {
      continue;
    }
  }
  throw new Error("unable to fetch text");
}

function pickTextUrl(formats) {
  const keys = Object.keys(formats || {});
  const exact = keys.find((k) => k.startsWith("text/plain; charset=utf-8"));
  if (exact) return formats[exact];
  const plain = keys.find((k) => k.startsWith("text/plain"));
  if (plain) return formats[plain];
  return null;
}

export default function App() {
  const [view, setView] = useState("catalog");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("All");
  const [books, setBooks] = useState([]);
  const [nextUrl, setNextUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const [selectedBook, setSelectedBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const fetchBooks = useCallback(
    async (reset) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        let url;
        if (reset) {
          const params = new URLSearchParams();
          if (query) params.set("search", query);
          if (genre !== "All") params.set("topic", genre.toLowerCase());
          url = `https://gutendex.com/books/?${params.toString()}`;
        } else {
          url = nextUrl;
        }
        if (!url) return;
        const res = await fetch(url);
        if (!res.ok) throw new Error("request failed");
        const data = await res.json();
        const filtered = data.results.filter((b) => pickTextUrl(b.formats));
        setBooks((prev) => (reset ? filtered : [...prev, ...filtered]));
        setNextUrl(data.next);
      } catch (e) {
        setError("The catalog could not be reached. Check your connection and try again.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, genre, nextUrl]
  );

  useEffect(() => {
    fetchBooks(true);
  }, [query, genre]);

  async function openBook(book) {
    setSelectedBook(book);
    setView("reader");
    setChapters([]);
    setChapterIndex(0);
    setTextError(null);
    setMenuOpen(false);
    setTextLoading(true);

    const cachedText = localStorage.getItem(`book_${book.id}`);
    if (cachedText) {
      const parsed = splitChapters(cachedText);
      setChapters(parsed);
      setTextLoading(false);
      return;
    }

    try {
      const url = pickTextUrl(book.formats);
      if (!url) throw new Error("no text format");
      const raw = await fetchTextWithFallback(url);
      const cleaned = stripBoilerplate(raw);
      localStorage.setItem(`book_${book.id}`, cleaned);
      const parsed = splitChapters(cleaned);
      setChapters(parsed);
    } catch (e) {
      setTextError("This book's text could not be loaded right now. Try another title.");
    } finally {
      setTextLoading(false);
    }
  }

  function backToCatalog() {
    setView("catalog");
    setSelectedBook(null);
    setChapters([]);
    setChapterIndex(0);
    setTextError(null);
  }

  function goToChapter(i) {
    setChapterIndex(i);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setQuery(searchInput.trim());
  }

  return (
    <div style={styles.root}>
      <style>{css}</style>

      {view === "catalog" && (
        <div className="catalog">
          <header className="masthead">
            <div className="masthead-top">
              <h1>THE READING ROOM</h1>
              <span className="masthead-sub">a catalog of public domain texts</span>
            </div>
            <form className="search-line" onSubmit={handleSearchSubmit}>
              <Search size={16} strokeWidth={2} />
              <input
                type="text"
                placeholder="Search by title or author"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button
                  type="button"
                  className="clear-btn"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchInput("");
                    setQuery("");
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </form>
          </header>

          <nav className="genre-row" aria-label="Filter by genre">
            {GENRES.map((g) => (
              <button
                key={g}
                className={"genre-chip" + (genre === g ? " active" : "")}
                onClick={() => setGenre(g)}
              >
                {g}
              </button>
            ))}
          </nav>

          <div className="rule-double" />

          {loading && <p className="status-line">Loading catalog.</p>}
          {error && <p className="status-line error">{error}</p>}
          {!loading && !error && books.length === 0 && (
            <p className="status-line">No results for that search.</p>
          )}

          <div className="card-grid">
            {books.map((book) => {
              const author = book.authors && book.authors.length > 0 ? book.authors[0].name : "Unknown";
              const tags = (book.bookshelves && book.bookshelves.length > 0
                ? book.bookshelves
                : book.subjects
              ).slice(0, 2);
              return (
                <article className="card" key={book.id}>
                  <div className="card-punch" />
                  <div className="card-number">PG NO. {String(book.id).padStart(5, "0")}</div>
                  <h2 className="card-title">{book.title}</h2>
                  <p className="card-author">{author}</p>
                  <div className="card-rule" />
                  <div className="card-tags">
                    {tags.map((t, i) => (
                      <span className="card-tag" key={i}>
                        {t.length > 28 ? t.slice(0, 28) + "…" : t}
                      </span>
                    ))}
                  </div>
                  <button className="stamp-btn" onClick={() => openBook(book)}>
                    READ
                  </button>
                </article>
              );
            })}
          </div>

          {nextUrl && !loading && (
            <div className="load-more-row">
              <button className="load-more-btn" onClick={() => fetchBooks(false)} disabled={loadingMore}>
                {loadingMore ? "Loading." : "Load more titles"}
              </button>
            </div>
          )}
        </div>
      )}

      {view === "reader" && selectedBook && (
        <div className="reader">
          <div className="reader-bar">
            <button className="back-btn" onClick={backToCatalog}>
              <ArrowLeft size={16} />
              CATALOG
            </button>
            <div className="reader-title">{selectedBook.title}</div>
            <div className="chapter-menu-wrap">
              <button
                className="chapter-menu-btn"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={chapters.length === 0}
              >
                CHAPTERS
                <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <div className="chapter-menu">
                  {chapters.map((c, i) => (
                    <button
                      key={i}
                      className={"chapter-menu-item" + (i === chapterIndex ? " active" : "")}
                      onClick={() => goToChapter(i)}
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rule-double" />

          <div className="reader-body">
            {textLoading && <p className="status-line">Loading text... this might take a minute for big books.</p>}
            {textError && <p className="status-line error">{textError}</p>}

            {!textLoading && !textError && chapters.length > 0 && (
              <>
                <p className="chapter-eyebrow">
                  {chapterIndex + 1} OF {chapters.length}
                </p>
                <h2 className="chapter-title">{chapters[chapterIndex].title}</h2>
                <div className="chapter-text">
                  {chapters[chapterIndex].body
                    .split(/\n\s*\n/)
                    .filter((p) => p.trim().length > 0)
                    .map((p, i) => (
                      <p key={i}>{p.replace(/\s+/g, " ").trim()}</p>
                    ))}
                </div>

                <div className="chapter-nav">
                  <button
                    disabled={chapterIndex === 0}
                    onClick={() => goToChapter(chapterIndex - 1)}
                  >
                    ← Previous
                  </button>
                  <button
                    disabled={chapterIndex === chapters.length - 1}
                    onClick={() => goToChapter(chapterIndex + 1)}
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh",
    background: "#ffffff",
  },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap');

  * { box-sizing: border-box; }

  .catalog, .reader {
    max-width: 1040px;
    margin: 0 auto;
    padding: 40px 24px 80px;
    font-family: 'Lora', serif;
    color: #0d0d0d;
  }

  .masthead-top {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }

  .masthead h1 {
    font-family: 'Courier Prime', monospace;
    font-weight: 700;
    font-size: 28px;
    letter-spacing: 0.06em;
    margin: 0;
  }

  .masthead-sub {
    font-family: 'Lora', serif;
    font-style: italic;
    color: #6e6e6e;
    font-size: 14px;
  }

  .search-line {
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid #0d0d0d;
    padding-bottom: 8px;
    max-width: 480px;
  }

  .search-line input {
    flex: 1;
    border: none;
    outline: none;
    font-family: 'Courier Prime', monospace;
    font-size: 14px;
    background: transparent;
    color: #0d0d0d;
  }

  .search-line input::placeholder {
    color: #9a9a9a;
  }

  .clear-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: #6e6e6e;
    padding: 2px;
  }
  .clear-btn:focus-visible, .search-line input:focus-visible {
    outline: 2px solid #0d0d0d;
    outline-offset: 2px;
  }

  .genre-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 24px 0 16px;
  }

  .genre-chip {
    font-family: 'Courier Prime', monospace;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    color: #0d0d0d;
    padding: 6px 12px;
    cursor: pointer;
  }

  .genre-chip.active {
    background: #0d0d0d;
    color: #ffffff;
  }

  .genre-chip:focus-visible {
    outline: 2px solid #0d0d0d;
    outline-offset: 2px;
  }

  .rule-double {
    border-top: 2px solid #0d0d0d;
    border-bottom: 1px solid #0d0d0d;
    height: 3px;
    margin: 12px 0 28px;
  }

  .status-line {
    font-family: 'Courier Prime', monospace;
    font-size: 13px;
    color: #6e6e6e;
    padding: 20px 0;
  }
  .status-line.error { color: #0d0d0d; }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
  }

  .card {
    position: relative;
    border: 1px solid #0d0d0d;
    padding: 18px 16px 16px;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    min-height: 240px;
  }

  .card-punch {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid #0d0d0d;
    background: #ffffff;
  }

  .card-number {
    font-family: 'Courier Prime', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: #6e6e6e;
    text-align: right;
    margin-bottom: 14px;
  }

  .card-title {
    font-family: 'Lora', serif;
    font-weight: 600;
    font-size: 17px;
    line-height: 1.3;
    margin: 0 0 6px;
  }

  .card-author {
    font-family: 'Lora', serif;
    font-style: italic;
    font-size: 13px;
    color: #6e6e6e;
    margin: 0 0 12px;
  }

  .card-rule {
    border-top: 1px dashed #b8b8b8;
    margin-bottom: 10px;
  }

  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    margin-bottom: 14px;
  }

  .card-tag {
    font-family: 'Courier Prime', monospace;
    font-size: 10px;
    color: #6e6e6e;
    border: 1px solid #cfcfcf;
    padding: 3px 6px;
  }

  .stamp-btn {
    align-self: flex-start;
    font-family: 'Courier Prime', monospace;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.08em;
    border: 2px solid #0d0d0d;
    background: #ffffff;
    color: #0d0d0d;
    padding: 6px 14px;
    cursor: pointer;
    transform: rotate(-1deg);
  }

  .stamp-btn:hover {
    background: #0d0d0d;
    color: #ffffff;
  }
  .stamp-btn:focus-visible {
    outline: 2px solid #0d0d0d;
    outline-offset: 3px;
  }

  .load-more-row {
    display: flex;
    justify-content: center;
    margin-top: 36px;
  }

  .load-more-btn {
    font-family: 'Courier Prime', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 10px 22px;
    cursor: pointer;
  }
  .load-more-btn:disabled { color: #9a9a9a; border-color: #9a9a9a; cursor: default; }

  .reader-bar {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Courier Prime', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 8px 12px;
    cursor: pointer;
  }

  .reader-title {
    font-family: 'Lora', serif;
    font-weight: 600;
    font-size: 16px;
    flex: 1;
    text-align: center;
    min-width: 160px;
  }

  .chapter-menu-wrap {
    position: relative;
  }

  .chapter-menu-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Courier Prime', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 8px 12px;
    cursor: pointer;
  }
  .chapter-menu-btn:disabled { color: #9a9a9a; border-color: #cfcfcf; cursor: default; }

  .chapter-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    background: #ffffff;
    border: 1px solid #0d0d0d;
    max-height: 320px;
    overflow-y: auto;
    width: 260px;
    z-index: 10;
  }

  .chapter-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    font-family: 'Courier Prime', monospace;
    font-size: 12px;
    background: none;
    border: none;
    border-bottom: 1px solid #ececec;
    padding: 10px 12px;
    cursor: pointer;
  }
  .chapter-menu-item.active { background: #0d0d0d; color: #ffffff; }
  .chapter-menu-item:hover:not(.active) { background: #f2f2f2; }

  .reader-body {
    max-width: 640px;
    margin: 0 auto;
  }

  .chapter-eyebrow {
    font-family: 'Courier Prime', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    color: #6e6e6e;
    text-align: center;
    margin-bottom: 6px;
  }

  .chapter-title {
    font-family: 'Lora', serif;
    font-weight: 600;
    font-size: 24px;
    text-align: center;
    margin: 0 0 32px;
  }

  .chapter-text p {
    font-family: 'Lora', serif;
    font-size: 17px;
    line-height: 1.75;
    margin: 0 0 20px;
    text-align: justify;
  }

  .chapter-nav {
    display: flex;
    justify-content: space-between;
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #0d0d0d;
  }

  .chapter-nav button {
    font-family: 'Courier Prime', monospace;
    font-size: 13px;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 10px 16px;
    cursor: pointer;
  }
  .chapter-nav button:disabled { color: #9a9a9a; border-color: #cfcfcf; cursor: default; }

  @media (max-width: 560px) {
    .masthead h1 { font-size: 22px; }
    .reader-title { order: -1; width: 100%; text-align: left; }
    .chapter-title { font-size: 20px; }
    .chapter-text p { text-align: left; }
  }
`;
