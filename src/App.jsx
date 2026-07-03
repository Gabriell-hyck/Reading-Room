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

function pickCoverUrl(formats) {
  const keys = Object.keys(formats || {});
  const coverKeys = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp"
  ];
  
  for (const key of coverKeys) {
    const found = keys.find((k) => k.startsWith(key));
    if (found) return formats[found];
  }
  
  const anyImage = keys.find((k) => k.startsWith("image/"));
  if (anyImage) return formats[anyImage];
  
  return null;
}

async function translateText(text, targetLang = "id") {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    return data[0].map(item => item[0]).join('');
  } catch (e) {
    console.error("Translation failed:", e);
    return text;
  }
}

async function translateChapter(text) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const translated = await Promise.all(
    paragraphs.map(async (p) => {
      const translatedP = await translateText(p);
      return translatedP;
    })
  );
  return translated.join('\n\n');
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

  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedText, setTranslatedText] = useState({});
  const [translating, setTranslating] = useState(false);

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
    setShowTranslation(false);
    setTranslatedText({});

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
    setShowTranslation(false);
    setTranslatedText({});
  }

  function goToChapter(i) {
    setChapterIndex(i);
    setMenuOpen(false);
    setShowTranslation(false);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setQuery(searchInput.trim());
  }

  async function handleTranslate() {
    if (chapters.length === 0 || !chapters[chapterIndex]) return;
    
    const currentChapter = chapters[chapterIndex];
    
    if (translatedText[currentChapter.title]) {
      setShowTranslation(true);
      return;
    }

    setTranslating(true);
    try {
      const translated = await translateChapter(currentChapter.body);
      setTranslatedText(prev => ({
        ...prev,
        [currentChapter.title]: translated
      }));
      setShowTranslation(true);
    } catch (e) {
      console.error("Translation error:", e);
    } finally {
      setTranslating(false);
    }
  }

  function toggleTranslation() {
    setShowTranslation(!showTranslation);
  }

  return (
    <div style={styles.root}>
      <style>{css}</style>

      {view === "catalog" && (
        <div className="catalog">
          {/* HERO SECTION */}
          <section className="hero">
            <div className="hero-content">
              <span className="hero-badge">public domain library</span>
              <h1 className="hero-title">Discover Lost Classics</h1>
              <p className="hero-sub">Thousands of public domain books, free to read. Philosophy, fiction, poetry, and more.</p>
              <form className="hero-search" onSubmit={handleSearchSubmit}>
                <Search size={18} strokeWidth={2} />
                <input
                  type="text"
                  placeholder="Search by title or author..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                {searchInput && (
                  <button type="button" className="clear-btn" onClick={() => { setSearchInput(""); setQuery(""); }}>
                    <X size={14} />
                  </button>
                )}
              </form>
            </div>
          </section>

          {/* FILTER & COUNT */}
          <div className="filter-bar">
            <div className="filter-left">
              <span className="result-count">{books.length} books</span>
              <div className="genre-select-wrap">
                <select 
                  className="genre-select" 
                  value={genre} 
                  onChange={(e) => setGenre(e.target.value)}
                >
                  {GENRES.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="select-arrow" />
              </div>
            </div>
            <div className="filter-right">
              {query && <span className="search-query">Search: "{query}"</span>}
            </div>
          </div>

          <div className="rule-double" />

          {loading && (
            <p className="status-line">
              Loading catalog.
              <span className="loading-dots"><span></span><span></span><span></span></span>
            </p>
          )}
          {error && <p className="status-line error">{error}</p>}
          {!loading && !error && books.length === 0 && (
            <p className="status-line">No results for that search.</p>
          )}

          {/* FEATURED BOOKS */}
          {!loading && !error && books.length > 0 && (
            <>
              <div className="section-header">
                <h2 className="section-title">Featured Books</h2>
                <span className="section-more">Browse all →</span>
              </div>
              <div className="featured-grid">
                {books.slice(0, 4).map((book) => {
                  const author = book.authors && book.authors.length > 0 ? book.authors[0].name : "Unknown";
                  const coverUrl = pickCoverUrl(book.formats);
                  return (
                    <div className="featured-card" key={book.id} onClick={() => openBook(book)}>
                      <div className="featured-cover">
                        {coverUrl ? (
                          <img src={coverUrl} alt={book.title} loading="lazy" />
                        ) : (
                          <div className="featured-placeholder">{book.title.charAt(0)}</div>
                        )}
                      </div>
                      <div className="featured-info">
                        <h3 className="featured-title">{book.title}</h3>
                        <p className="featured-author">{author}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ALL BOOKS GRID */}
          {!loading && !error && books.length > 0 && (
            <>
              <div className="section-header">
                <h2 className="section-title">All Books</h2>
              </div>
              <div className="card-grid">
                {books.map((book) => {
                  const author = book.authors && book.authors.length > 0 ? book.authors[0].name : "Unknown";
                  const tags = (book.bookshelves && book.bookshelves.length > 0
                    ? book.bookshelves
                    : book.subjects
                  ).slice(0, 2);
                  const coverUrl = pickCoverUrl(book.formats);
                  return (
                    <article className="card" key={book.id}>
                      <div className="card-punch" />
                      <div className="card-cover-wrap">
                        {coverUrl ? (
                          <img 
                            src={coverUrl} 
                            alt={`Cover of ${book.title}`}
                            className="card-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              const parent = e.target.parentElement;
                              const placeholder = document.createElement('div');
                              placeholder.className = 'card-cover-placeholder';
                              placeholder.innerHTML = `<span>${book.title.charAt(0)}</span>`;
                              parent.appendChild(placeholder);
                            }}
                          />
                        ) : (
                          <div className="card-cover-placeholder">
                            <span>{book.title.charAt(0)}</span>
                          </div>
                        )}
                      </div>
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
            </>
          )}

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
            <div className="reader-actions">
              <button 
                className={"translate-btn" + (showTranslation ? " translated" : "")}
                onClick={showTranslation ? toggleTranslation : handleTranslate}
                disabled={translating || chapters.length === 0}
              >
                {translating ? 'Translating...' : showTranslation ? 'Show Original' : 'Translate to Indonesian'}
              </button>
            </div>
          </div>

          <div className="progress-container">
            <div className="progress-track">
              <div 
                className="progress-fill" 
                style={{ 
                  width: chapters.length > 0 ? `${((chapterIndex + 1) / chapters.length) * 100}%` : '0%' 
                }} 
              />
            </div>
            <span className="progress-text">
              {chapters.length > 0 ? `${chapterIndex + 1}/${chapters.length}` : '0/0'}
            </span>
          </div>

          <div className="rule-double" />

          <div className="reader-body">
            {textLoading && (
              <p className="status-line">
                Loading text... this might take a minute for big books.
                <span className="loading-dots">
                  <span></span><span></span><span></span>
                </span>
              </p>
            )}
            {textError && <p className="status-line error">{textError}</p>}

            {!textLoading && !textError && chapters.length > 0 && (
              <>
                <p className="chapter-eyebrow">
                  {chapterIndex + 1} OF {chapters.length}
                </p>
                <h2 className="chapter-title">{chapters[chapterIndex].title}</h2>
                <div className="chapter-text">
                  {(() => {
                    const currentChapter = chapters[chapterIndex];
                    const displayText = showTranslation && translatedText[currentChapter.title] 
                      ? translatedText[currentChapter.title] 
                      : currentChapter.body;
                    
                    return displayText
                      .split(/\n\s*\n/)
                      .filter((p) => p.trim().length > 0)
                      .map((p, i) => (
                        <p key={i}>{p.replace(/\s+/g, " ").trim()}</p>
                      ));
                  })()}
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
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Playfair+Display:ital,wght@0,600;1,400&display=swap');

  * { box-sizing: border-box; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes stampIn {
    from { transform: rotate(-1deg) scale(0.8); opacity: 0; }
    to { transform: rotate(-1deg) scale(1); opacity: 1; }
  }

  .catalog, .reader {
    max-width: 1040px;
    margin: 0 auto;
    padding: 40px 24px 80px;
    font-family: 'Inter', sans-serif;
    color: #0d0d0d;
  }

  ::selection {
    background: #0d0d0d;
    color: #ffffff;
  }

  .chapter-text p::selection {
    background: #0d0d0d;
    color: #ffffff;
  }

  /* HERO */
  .hero {
    padding: 60px 0 40px;
    text-align: center;
    border-bottom: 2px solid #0d0d0d;
    margin-bottom: 32px;
  }

  .hero-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #6e6e6e;
    display: inline-block;
    margin-bottom: 12px;
  }

  .hero-title {
    font-family: 'Playfair Display', serif;
    font-size: 44px;
    font-weight: 600;
    margin: 0 0 12px;
    letter-spacing: -0.02em;
  }

  .hero-sub {
    font-family: 'Inter', sans-serif;
    font-size: 16px;
    color: #6e6e6e;
    max-width: 480px;
    margin: 0 auto 28px;
    line-height: 1.6;
  }

  .hero-search {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 480px;
    margin: 0 auto;
    border-bottom: 2px solid #0d0d0d;
    padding-bottom: 10px;
  }

  .hero-search input {
    flex: 1;
    border: none;
    outline: none;
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    background: transparent;
    color: #0d0d0d;
    padding: 4px 0;
  }

  .hero-search input::placeholder {
    color: #b0b0b0;
    font-style: italic;
  }

  .hero-search .clear-btn {
    border: none;
    background: none;
    cursor: pointer;
    color: #6e6e6e;
    padding: 2px;
  }

  /* FILTER BAR */
  .filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 8px;
  }

  .filter-left {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .result-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #6e6e6e;
  }

  .genre-select-wrap {
    position: relative;
    display: inline-block;
  }

  .genre-select {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 6px 32px 6px 14px;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    border-radius: 2px;
    color: #0d0d0d;
  }

  .genre-select:focus {
    outline: 2px solid #0d0d0d;
    outline-offset: 2px;
  }

  .select-arrow {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: #6e6e6e;
  }

  .filter-right .search-query {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #6e6e6e;
    font-style: italic;
  }

  /* SECTION HEADER */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 32px 0 16px;
  }

  .section-title {
    font-family: 'Playfair Display', serif;
    font-size: 20px;
    font-weight: 600;
    margin: 0;
  }

  .section-more {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #6e6e6e;
    cursor: pointer;
    letter-spacing: 0.04em;
  }

  .section-more:hover {
    color: #0d0d0d;
  }

  /* FEATURED GRID */
  .featured-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 8px;
  }

  .featured-card {
    cursor: pointer;
    border: 1px solid #e8e8e8;
    overflow: hidden;
    transition: all 0.2s ease;
    background: #ffffff;
  }

  .featured-card:hover {
    border-color: #0d0d0d;
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.06);
  }

  .featured-cover {
    aspect-ratio: 2/3;
    background: #f5f5f5;
    overflow: hidden;
  }

  .featured-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .featured-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 600;
    color: #d0d0d0;
    background: #f5f5f5;
  }

  .featured-info {
    padding: 10px 12px 12px;
  }

  .featured-title {
    font-family: 'Playfair Display', serif;
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 2px;
    line-height: 1.3;
  }

  .featured-author {
    font-family: 'Inter', sans-serif;
    font-size: 11px;
    color: #6e6e6e;
    margin: 0;
    font-style: italic;
  }

  .rule-double {
    border-top: 2px solid #0d0d0d;
    border-bottom: 1px solid #0d0d0d;
    height: 3px;
    margin: 12px 0 28px;
  }

  .status-line {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: #6e6e6e;
    padding: 20px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-line.error { color: #0d0d0d; }

  .loading-dots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }

  .loading-dots span {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6e6e6e;
    animation: pulse 1.2s ease infinite;
  }

  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 20px;
  }

  .card {
    position: relative;
    border: 1px solid #0d0d0d;
    padding: 16px 16px 16px;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    min-height: 340px;
    animation: fadeIn 0.4s ease both;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    border-radius: 2px;
  }

  .card:hover {
    transform: translateY(-6px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.06);
  }

  .card:nth-child(1) { animation-delay: 0.00s; }
  .card:nth-child(2) { animation-delay: 0.04s; }
  .card:nth-child(3) { animation-delay: 0.08s; }
  .card:nth-child(4) { animation-delay: 0.12s; }
  .card:nth-child(5) { animation-delay: 0.16s; }
  .card:nth-child(6) { animation-delay: 0.20s; }
  .card:nth-child(7) { animation-delay: 0.24s; }
  .card:nth-child(8) { animation-delay: 0.28s; }
  .card:nth-child(9) { animation-delay: 0.32s; }
  .card:nth-child(10) { animation-delay: 0.36s; }
  .card:nth-child(11) { animation-delay: 0.40s; }
  .card:nth-child(12) { animation-delay: 0.44s; }

  .card-punch {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    transition: background 0.2s ease;
  }

  .card:hover .card-punch {
    background: #0d0d0d;
  }

  .card-cover-wrap {
    width: 100%;
    aspect-ratio: 2/3;
    margin-bottom: 10px;
    background: #f5f5f5;
    border: 1px solid #e8e8e8;
    border-radius: 2px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s ease;
  }

  .card:hover .card-cover-wrap {
    border-color: #0d0d0d;
  }

  .card-cover {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f5f5f5;
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 600;
    color: #d0d0d0;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .card-cover-placeholder span {
    display: block;
    opacity: 0.4;
  }

  .card-number {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    color: #6e6e6e;
    text-align: right;
    margin-bottom: 6px;
    margin-top: 6px;
  }

  .card-title {
    font-family: 'Playfair Display', serif;
    font-weight: 600;
    font-size: 16px;
    line-height: 1.3;
    margin: 0 0 2px;
  }

  .card-author {
    font-family: 'Inter', serif;
    font-style: italic;
    font-size: 12px;
    color: #6e6e6e;
    margin: 0 0 8px;
  }

  .card-rule {
    border-top: 1px dashed #b8b8b8;
    margin-bottom: 8px;
  }

  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
    margin-bottom: 10px;
  }

  .card-tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #6e6e6e;
    border: 1px solid #e8e8e8;
    padding: 2px 6px;
    border-radius: 2px;
    transition: all 0.15s ease;
  }

  .card:hover .card-tag {
    border-color: #0d0d0d;
  }

  .stamp-btn {
    align-self: flex-start;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.08em;
    border: 2px solid #0d0d0d;
    background: #ffffff;
    color: #0d0d0d;
    padding: 6px 14px;
    cursor: pointer;
    transform: rotate(-1deg);
    transition: all 0.15s ease;
    animation: stampIn 0.5s ease both;
    animation-delay: 0.2s;
  }

  .stamp-btn:hover {
    background: #0d0d0d;
    color: #ffffff;
    transform: rotate(0deg) scale(1.05);
  }

  .stamp-btn:active {
    transform: rotate(-2deg) scale(0.95);
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
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 10px 22px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .load-more-btn:hover:not(:disabled) {
    background: #0d0d0d;
    color: #ffffff;
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
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 8px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .back-btn:hover {
    background: #0d0d0d;
    color: #ffffff;
  }

  .reader-title {
    font-family: 'Playfair Display', serif;
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
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 8px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .chapter-menu-btn:hover:not(:disabled) {
    background: #0d0d0d;
    color: #ffffff;
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
    animation: slideDown 0.2s ease both;
  }

  .chapter-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    background: none;
    border: none;
    border-bottom: 1px solid #ececec;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .chapter-menu-item.active { background: #0d0d0d; color: #ffffff; }
  .chapter-menu-item:hover:not(.active) { background: #f2f2f2; }

  .reader-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .translate-btn {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.05em;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 6px 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .translate-btn:hover:not(:disabled) {
    background: #0d0d0d;
    color: #ffffff;
  }

  .translate-btn:disabled {
    color: #9a9a9a;
    border-color: #cfcfcf;
    cursor: default;
  }

  .translate-btn.translated {
    background: #0d0d0d;
    color: #ffffff;
  }

  .progress-container {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin-top: 12px;
    margin-bottom: 4px;
  }

  .progress-track {
    flex: 1;
    height: 4px;
    background: #e8e8e8;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #0d0d0d;
    transition: width 0.3s ease;
    border-radius: 2px;
  }

  .progress-text {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #6e6e6e;
    white-space: nowrap;
    min-width: 40px;
    text-align: right;
  }

  .reader-body {
    max-width: 680px;
    margin: 0 auto;
    padding: 0 8px;
  }

  .chapter-eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6e6e6e;
    text-align: center;
    margin-bottom: 8px;
  }

  .chapter-title {
    font-family: 'Playfair Display', serif;
    font-weight: 600;
    font-size: 28px;
    text-align: center;
    margin: 0 0 36px;
    letter-spacing: -0.01em;
  }

  .chapter-text p {
    font-family: 'Inter', sans-serif;
    font-size: 17px;
    line-height: 1.8;
    margin: 0 0 20px;
    text-align: justify;
  }

  .chapter-text p:first-of-type::first-letter {
    font-family: 'Playfair Display', serif;
    font-size: 48px;
    float: left;
    line-height: 1;
    margin-right: 6px;
    margin-top: 4px;
    font-weight: 600;
  }

  .chapter-nav {
    display: flex;
    justify-content: space-between;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 2px solid #0d0d0d;
  }

  .chapter-nav button {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    border: 1px solid #0d0d0d;
    background: #ffffff;
    padding: 10px 20px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .chapter-nav button:hover:not(:disabled) {
    background: #0d0d0d;
    color: #ffffff;
  }

  .chapter-nav button:disabled {
    color: #b0b0b0;
    border-color: #d0d0d0;
    cursor: default;
  }

  @media (max-width: 820px) {
    .catalog, .reader {
      padding: 32px 20px 60px;
    }

    .featured-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .hero-title {
      font-size: 32px;
    }

    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }

    .card {
      min-height: 280px;
    }

    .reader-body {
      max-width: 100%;
      padding: 0 4px;
    }

    .chapter-title {
      font-size: 24px;
    }

    .chapter-text p {
      font-size: 16px;
    }
  }

  @media (max-width: 640px) {
    .catalog, .reader {
      padding: 24px 16px 48px;
    }

    .hero {
      padding: 32px 0 24px;
    }

    .hero-title {
      font-size: 26px;
    }

    .hero-sub {
      font-size: 14px;
    }

    .featured-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .filter-bar {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .filter-left {
      width: 100%;
    }

    .genre-select {
      font-size: 10px;
      padding: 4px 28px 4px 10px;
    }

    .section-title {
      font-size: 17px;
    }

    .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
    }

    .card {
      min-height: 260px;
      padding: 12px 12px 12px;
    }

    .card-cover-wrap {
      aspect-ratio: 2/3;
      margin-bottom: 6px;
    }

    .card-cover-placeholder {
      font-size: 24px;
    }

    .card-title {
      font-size: 14px;
    }

    .card-author {
      font-size: 11px;
    }

    .card-number {
      font-size: 8px;
      margin-top: 4px;
    }

    .reader-bar {
      gap: 12px;
    }

    .reader-title {
      order: -1;
      width: 100%;
      text-align: left;
      font-size: 14px;
    }

    .back-btn, .chapter-menu-btn {
      font-size: 10px;
      padding: 6px 10px;
    }

    .translate-btn {
      font-size: 9px;
      padding: 4px 10px;
    }

    .chapter-title {
      font-size: 20px;
      margin-bottom: 24px;
    }

    .chapter-text p {
      font-size: 15px;
      line-height: 1.7;
      text-align: left;
    }

    .chapter-text p:first-of-type::first-letter {
      font-size: 36px;
      margin-right: 4px;
    }

    .chapter-nav {
      flex-direction: column;
      gap: 8px;
      margin-top: 32px;
      padding-top: 16px;
    }

    .chapter-nav button {
      width: 100%;
      text-align: center;
      padding: 10px;
      font-size: 12px;
    }

    .rule-double {
      margin: 8px 0 20px;
    }

    .progress-container {
      margin-top: 8px;
    }

    .progress-text {
      font-size: 10px;
      min-width: 32px;
    }
  }

  @media (max-width: 400px) {
    .featured-grid {
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .featured-title {
      font-size: 11px;
    }

    .featured-author {
      font-size: 10px;
    }

    .card-grid {
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .card {
      min-height: 220px;
      padding: 10px 10px 10px;
    }

    .card-cover-wrap {
      aspect-ratio: 2/3;
      margin-bottom: 4px;
    }

    .card-cover-placeholder {
      font-size: 18px;
    }

    .card-title {
      font-size: 12px;
    }

    .card-author {
      font-size: 10px;
    }

    .card-tag {
      font-size: 7px;
      padding: 1px 4px;
    }

    .stamp-btn {
      font-size: 9px;
      padding: 3px 8px;
    }

    .chapter-text p {
      font-size: 14px;
    }
  }
`;
