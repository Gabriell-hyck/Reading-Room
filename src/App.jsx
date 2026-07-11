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
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  const mirrors = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://r.jina.ai/${url}`
  ];

  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, { signal: controller.signal });
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
  const coverKeys = ["image/jpeg", "image/png", "image/gif", "image/webp"];
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

  const [fontSize, setFontSize] = useState(18);
  const [readerTheme, setReaderTheme] = useState('light');

  const [history, setHistory] = useState([]);
  const [continueBooks, setContinueBooks] = useState([]);

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [pageTransition, setPageTransition] = useState(false);

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

  useEffect(() => {
    const savedHistory = localStorage.getItem('reading_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
        if (parsed.length > 0) {
          setContinueBooks(parsed.slice(0, 4));
        }
      } catch (e) {
        console.error('Failed to load history');
      }
    }
  }, []);

  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode) {
      const isDark = JSON.parse(savedDarkMode);
      setDarkMode(isDark);
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    }
  }, []);

  function toggleDarkMode() {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', JSON.stringify(newMode));
    document.documentElement.setAttribute('data-theme', newMode ? 'dark' : 'light');
  }

  function saveProgress(book, chapterIdx, totalChapters) {
    const existingIndex = history.findIndex(h => h.id === book.id);
    const entry = {
      id: book.id,
      title: book.title,
      author: book.authors && book.authors.length > 0 ? book.authors[0].name : 'Unknown',
      cover: pickCoverUrl(book.formats),
      lastChapter: chapterIdx + 1,
      totalChapters: totalChapters,
      progress: totalChapters > 0 ? Math.round(((chapterIdx + 1) / totalChapters) * 100) : 0,
      timestamp: Date.now()
    };

    let newHistory;
    if (existingIndex >= 0) {
      newHistory = [...history];
      newHistory[existingIndex] = entry;
      newHistory = [entry, ...newHistory.filter(h => h.id !== book.id)];
    } else {
      newHistory = [entry, ...history];
    }

    if (newHistory.length > 20) {
      newHistory = newHistory.slice(0, 20);
    }

    setHistory(newHistory);
    setContinueBooks(newHistory.slice(0, 4));
    localStorage.setItem('reading_history', JSON.stringify(newHistory));
  }

  function removeFromHistory(bookId) {
    const newHistory = history.filter(h => h.id !== bookId);
    setHistory(newHistory);
    setContinueBooks(newHistory.slice(0, 4));
    localStorage.setItem('reading_history', JSON.stringify(newHistory));
  }

  function increaseFont() {
    if (fontSize < 26) setFontSize(fontSize + 1);
  }

  function decreaseFont() {
    if (fontSize > 14) setFontSize(fontSize - 1);
  }

  function toggleTheme() {
    const themes = ['light', 'sepia', 'dark'];
    const currentIndex = themes.indexOf(readerTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setReaderTheme(themes[nextIndex]);
  }

  function getThemeStyles() {
    switch(readerTheme) {
      case 'sepia':
        return { 
          background: '#faf0e6', 
          color: '#4a3728', 
          borderColor: '#d4c5a0',
          progressTrack: '#e8ddd0',
          metaColor: '#8a7a6a'
        };
      case 'dark':
        return { 
          background: '#1a1a1a', 
          color: '#e0e0e0', 
          borderColor: '#333333',
          progressTrack: '#333333',
          metaColor: '#888888'
        };
      default:
        return { 
          background: '#ffffff', 
          color: '#1a1a1a', 
          borderColor: '#e8e8e8',
          progressTrack: '#e8e8e8',
          metaColor: '#888888'
        };
    }
  }

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
      const historyEntry = history.find(h => h.id === book.id);
      if (historyEntry && historyEntry.lastChapter <= parsed.length) {
        setChapterIndex(historyEntry.lastChapter - 1);
      }
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
      const historyEntry = history.find(h => h.id === book.id);
      if (historyEntry && historyEntry.lastChapter <= parsed.length) {
        setChapterIndex(historyEntry.lastChapter - 1);
      }
    } catch (e) {
      setTextError("This book's text could not be loaded right now. Try another title.");
    } finally {
      setTextLoading(false);
    }
  }

  function backToCatalog() {
    if (selectedBook && chapters.length > 0) {
      saveProgress(selectedBook, chapterIndex, chapters.length);
    }
    setView("catalog");
    setSelectedBook(null);
    setChapters([]);
    setChapterIndex(0);
    setTextError(null);
    setShowTranslation(false);
    setTranslatedText({});
  }

  function goToChapter(i) {
    if (i === chapterIndex) return;
    setPageTransition(true);
    setTimeout(() => {
      setChapterIndex(i);
      setMenuOpen(false);
      setShowTranslation(false);
      if (selectedBook && chapters.length > 0) {
        saveProgress(selectedBook, i, chapters.length);
      }
      setTimeout(() => setPageTransition(false), 300);
    }, 200);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    setQuery(searchInput.trim());
  }

  function scrollToAllBooks() {
    const section = document.querySelector('#all-books');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth' });
    }
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

  const theme = getThemeStyles();

  return (
    <div className="app-wrapper" data-theme={darkMode ? 'dark' : 'light'}>
      <style>{css}</style>

      {view === "catalog" && (
        <div className="catalog">
          <div className="catalog-header">
            <div className="catalog-title">
              <h1>The Reading Room</h1>
              <span className="catalog-sub">public domain library</span>
            </div>
            <button className="dark-toggle" onClick={toggleDarkMode}>
              {darkMode ? '☀️' : '🌙'}
            </button>
          </div>

          <div className="hero">
            <h2>Discover Lost Classics</h2>
            <p>Thousands of public domain books, free to read. Philosophy, fiction, poetry, and more.</p>
            <form className="hero-search" onSubmit={handleSearchSubmit}>
              <Search size={18} />
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

          {continueBooks.length > 0 && (
            <>
              <div className="section-header">
                <h3>Continue Reading</h3>
              </div>
              <div className="continue-grid">
                {continueBooks.map((book) => (
                  <div
                    className="continue-card"
                    key={book.id}
                    onClick={() => {
                      fetch(`https://gutendex.com/books/${book.id}`)
                        .then(res => res.json())
                        .then(data => { if (data && data.id) openBook(data); })
                        .catch(() => {});
                    }}
                  >
                    <div className="continue-cover">
                      {book.cover ? (
                        <img src={book.cover} alt={book.title} loading="lazy" />
                      ) : (
                        <div className="continue-placeholder">{book.title.charAt(0)}</div>
                      )}
                    </div>
                    <div className="continue-info">
                      <h4>{book.title}</h4>
                      <p>{book.author}</p>
                      <div className="continue-progress">
                        <div className="continue-progress-track">
                          <div className="continue-progress-fill" style={{ width: `${book.progress}%` }} />
                        </div>
                        <span>{book.progress}%</span>
                      </div>
                      <small>Chapter {book.lastChapter} of {book.totalChapters}</small>
                    </div>
                    <button
                      className="continue-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromHistory(book.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="filter-bar">
            <div className="filter-left">
              <span className="result-count">{books.length} books</span>
              <div className="genre-select-wrap">
                <select className="genre-select" value={genre} onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="select-arrow" />
              </div>
            </div>
            {query && <span className="search-query">Search: "{query}"</span>}
          </div>

          <div className="rule" />

          {loading && (
            <div className="status-line">
              Loading catalog...
              <span className="loading-dots"><span></span><span></span><span></span></span>
            </div>
          )}
          {error && <div className="status-line error">{error}</div>}
          {!loading && !error && books.length === 0 && (
            <div className="status-line">No results for that search.</div>
          )}

          {!loading && !error && books.length > 0 && (
            <>
              <div className="section-header">
                <h3>Featured Books</h3>
                <button className="section-more" onClick={scrollToAllBooks}>Browse all →</button>
              </div>
              <div className="featured-grid">
                {books.slice(0, 4).map((book) => {
                  const author = book.authors?.[0]?.name || "Unknown";
                  const cover = pickCoverUrl(book.formats);
                  return (
                    <div className="featured-card" key={book.id} onClick={() => openBook(book)}>
                      <div className="featured-cover">
                        {cover ? (
                          <img src={cover} alt={book.title} loading="lazy" />
                        ) : (
                          <div className="featured-placeholder">{book.title.charAt(0)}</div>
                        )}
                      </div>
                      <div className="featured-info">
                        <h4>{book.title}</h4>
                        <p>{author}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="section-header" id="all-books">
                <h3>All Books</h3>
              </div>
              <div className="book-grid">
                {books.map((book) => {
                  const author = book.authors?.[0]?.name || "Unknown";
                  const tags = (book.bookshelves?.length > 0 ? book.bookshelves : book.subjects || []).slice(0, 2);
                  const cover = pickCoverUrl(book.formats);
                  return (
                    <div className="book-card" key={book.id}>
                      <div className="book-cover">
                        {cover ? (
                          <img src={cover} alt={book.title} loading="lazy" />
                        ) : (
                          <div className="book-cover-placeholder">{book.title.charAt(0)}</div>
                        )}
                      </div>
                      <div className="book-info">
                        <h4>{book.title}</h4>
                        <p>{author}</p>
                        <div className="book-tags">
                          {tags.map((t, i) => (
                            <span key={i}>{t.length > 20 ? t.slice(0, 20) + "…" : t}</span>
                          ))}
                        </div>
                        <button className="read-btn" onClick={() => openBook(book)}>Read</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {nextUrl && !loading && (
            <div className="load-more">
              <button onClick={() => fetchBooks(false)} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}

          <footer className="footer">
            <div className="footer-content">
              <div>
                <h4>The Reading Room</h4>
                <p>Your place to find lost knowledge</p>
              </div>
              <div className="footer-links">
                <div>
                  <h5>Browse</h5>
                  <button onClick={() => setGenre("All")}>All</button>
                  <button onClick={() => setGenre("Fiction")}>Fiction</button>
                  <button onClick={() => setGenre("Philosophy")}>Philosophy</button>
                  <button onClick={() => setGenre("Poetry")}>Poetry</button>
                </div>
                <div>
                  <h5>Info</h5>
                  <a href="https://gutendex.com" target="_blank" rel="noopener noreferrer">Gutendex API</a>
                  <a href="https://www.gutenberg.org" target="_blank" rel="noopener noreferrer">Project Gutenberg</a>
                </div>
                <div>
                  <h5>Connect</h5>
                  <a href="https://github.com/Gabriell-hyck/Reading-Room" target="_blank" rel="noopener noreferrer">GitHub</a>
                </div>
              </div>
            </div>
            <div className="footer-bottom">
              <p>All books are in the public domain. Built with React + Gutendex API.</p>
              <p>&copy; {new Date().getFullYear()} The Reading Room</p>
            </div>
          </footer>
        </div>
      )}

      {view === "reader" && selectedBook && (
        <div className="reader-wrapper" style={{ backgroundColor: theme.background }}>
          <div className="reader-header" style={{ backgroundColor: theme.background, borderBottom: `1px solid ${theme.borderColor}` }}>
            <div className="reader-header-top">
              <button className="reader-back" onClick={backToCatalog} style={{ color: theme.color }}>
                <ArrowLeft size={18} />
                <span>Library</span>
              </button>
              <span className="reader-header-title" style={{ color: theme.color }}>{selectedBook.title}</span>
              <div className="reader-header-actions">
                <button className="reader-chapter-btn" onClick={() => setMenuOpen(!menuOpen)} disabled={chapters.length === 0} style={{ color: theme.color, borderColor: theme.borderColor }}>
                  {chapters.length > 0 ? `${chapterIndex + 1}/${chapters.length}` : '0/0'}
                  <ChevronDown size={14} />
                </button>
                {menuOpen && (
                  <div className="chapter-menu-dropdown" style={{ backgroundColor: theme.background, borderColor: theme.borderColor }}>
                    {chapters.map((c, i) => (
                      <button
                        key={i}
                        className={"chapter-menu-item" + (i === chapterIndex ? " active" : "")}
                        onClick={() => goToChapter(i)}
                        style={i === chapterIndex ? { background: theme.color, color: theme.background } : { color: theme.color }}
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="reader-progress">
              <div className="reader-progress-track" style={{ backgroundColor: theme.progressTrack }}>
                <div className="reader-progress-fill" style={{ width: chapters.length > 0 ? `${((chapterIndex + 1) / chapters.length) * 100}%` : '0%', backgroundColor: theme.color }} />
              </div>
            </div>
          </div>

          <div className={`reader-body ${pageTransition ? 'page-transition' : ''}`} style={{ backgroundColor: theme.background }}>
            {textLoading && (
              <div className="reader-loading">
                <div className="shimmer-wrapper">
                  <div className="shimmer-line"></div>
                  <div className="shimmer-line"></div>
                  <div className="shimmer-line short"></div>
                  <div className="shimmer-line"></div>
                  <div className="shimmer-line"></div>
                </div>
              </div>
            )}
            {textError && <div className="reader-error" style={{ color: theme.color }}>{textError}</div>}

            {!textLoading && !textError && chapters.length > 0 && (
              <div className="reader-content">
                <div className="reader-chapter-label" style={{ color: theme.metaColor }}>
                  {chapters[chapterIndex].title}
                </div>
                <div className="reader-text" style={{ fontSize: `${fontSize}px`, color: theme.color }}>
                  {(() => {
                    const currentChapter = chapters[chapterIndex];
                    const displayText = showTranslation && translatedText[currentChapter.title] 
                      ? translatedText[currentChapter.title] 
                      : currentChapter.body;
                    return displayText
                      .split(/\n\s*\n/)
                      .filter(p => p.trim().length > 0)
                      .map((p, i) => (
                        <p key={i} className="fade-in-text" style={{ animationDelay: `${i * 0.03}s` }}>
                          {p.replace(/\s+/g, " ").trim()}
                        </p>
                      ));
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className="reader-footer" style={{ backgroundColor: theme.background, borderTop: `1px solid ${theme.borderColor}` }}>
            <div className="reader-controls">
              <div className="reader-controls-left">
                <button className="reader-nav-btn" onClick={() => goToChapter(chapterIndex - 1)} disabled={chapterIndex === 0} style={{ color: theme.color, borderColor: theme.borderColor }}>←</button>
                <span className="reader-page-info" style={{ color: theme.metaColor }}>{chapterIndex + 1} / {chapters.length}</span>
                <button className="reader-nav-btn" onClick={() => goToChapter(chapterIndex + 1)} disabled={chapterIndex === chapters.length - 1} style={{ color: theme.color, borderColor: theme.borderColor }}>→</button>
              </div>
              <div className="reader-controls-center">
                <button className="reader-font-btn" onClick={decreaseFont} disabled={fontSize <= 14} style={{ color: theme.color, borderColor: theme.borderColor }}>A−</button>
                <span className="reader-font-size" style={{ color: theme.metaColor }}>{fontSize}</span>
                <button className="reader-font-btn" onClick={increaseFont} disabled={fontSize >= 26} style={{ color: theme.color, borderColor: theme.borderColor }}>A+</button>
              </div>
              <div className="reader-controls-right">
                <button className="reader-theme-btn" onClick={toggleTheme} style={{ color: theme.color, borderColor: theme.borderColor }}>
                  {readerTheme === 'light' ? '☀' : readerTheme === 'sepia' ? '🕯' : '🌙'}
                </button>
                <button className="reader-translate-btn" onClick={showTranslation ? toggleTranslation : handleTranslate} disabled={translating || chapters.length === 0} style={{ color: theme.color, borderColor: theme.borderColor }}>
                  {translating ? '...' : showTranslation ? 'EN' : 'ID'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Playfair+Display:ital,wght@0,600;1,400&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', sans-serif;
    background: #ffffff;
    color: #0d0d0d;
    transition: background 0.3s ease, color 0.3s ease;
  }

  .app-wrapper {
    min-height: 100vh;
    background: var(--bg, #ffffff);
    color: var(--text, #0d0d0d);
    transition: background 0.3s ease, color 0.3s ease;
  }

  :root {
    --bg: #ffffff;
    --text: #0d0d0d;
    --border: #e8e8e8;
    --card: #ffffff;
    --card-border: #e8e8e8;
    --hover: #f5f5f5;
    --meta: #6e6e6e;
  }

  [data-theme="dark"] {
    --bg: #121212;
    --text: #e0e0e0;
    --border: #2a2a2a;
    --card: #1e1e1e;
    --card-border: #2a2a2a;
    --hover: #2a2a2a;
    --meta: #888888;
  }

  .catalog {
    max-width: 1040px;
    margin: 0 auto;
    padding: 32px 24px 60px;
  }

  .catalog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 32px;
  }

  .catalog-title h1 {
    font-family: 'Playfair Display', serif;
    font-size: 24px;
    font-weight: 600;
    color: var(--text);
  }

  .catalog-sub {
    font-size: 13px;
    color: var(--meta);
    font-style: italic;
    display: block;
    margin-top: -2px;
  }

  .dark-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 18px;
    cursor: pointer;
    color: var(--text);
    background: var(--card);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dark-toggle:hover {
    border-color: var(--text);
    transform: scale(1.05);
  }

  .hero {
    text-align: center;
    padding: 40px 0 32px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 32px;
  }

  .hero h2 {
    font-family: 'Playfair Display', serif;
    font-size: 36px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
  }

  .hero p {
    font-size: 15px;
    color: var(--meta);
    max-width: 480px;
    margin: 0 auto 20px;
    line-height: 1.6;
  }

  .hero-search {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 440px;
    margin: 0 auto;
    border-bottom: 2px solid var(--border);
    padding-bottom: 8px;
    transition: border-color 0.2s ease;
  }

  .hero-search:focus-within {
    border-bottom-color: var(--text);
  }

  .hero-search input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 15px;
    color: var(--text);
    padding: 4px 0;
  }

  .hero-search input::placeholder {
    color: var(--meta);
    font-style: italic;
  }

  .hero-search .clear-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--meta);
    padding: 2px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 28px 0 14px;
  }

  .section-header h3 {
    font-family: 'Playfair Display', serif;
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .section-more {
    background: none;
    border: none;
    font-size: 12px;
    color: var(--meta);
    cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    transition: color 0.2s ease;
  }

  .section-more:hover {
    color: var(--text);
  }

  .rule {
    border-top: 1px solid var(--border);
    margin: 16px 0 24px;
  }

  .filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .filter-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .result-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--meta);
  }

  .genre-select-wrap {
    position: relative;
  }

  .genre-select {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    padding: 5px 30px 5px 12px;
    border-radius: 4px;
    appearance: none;
    cursor: pointer;
    transition: border-color 0.2s ease;
  }

  .genre-select:hover {
    border-color: var(--text);
  }

  .genre-select:focus {
    outline: none;
    border-color: var(--text);
  }

  .select-arrow {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--meta);
  }

  .search-query {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--meta);
    font-style: italic;
  }

  .status-line {
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
    color: var(--meta);
    padding: 20px 0;
  }

  .status-line.error {
    color: var(--text);
  }

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
    background: var(--meta);
    animation: pulse 1.2s ease infinite;
  }

  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .book-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 20px;
  }

  .book-card {
    border: 1px solid var(--card-border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--card);
    transition: all 0.2s ease;
  }

  .book-card:hover {
    border-color: var(--text);
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.06);
  }

  .book-cover {
    aspect-ratio: 2/3;
    background: var(--border);
    overflow: hidden;
  }

  .book-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .book-cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Playfair Display', serif;
    font-size: 32px;
    font-weight: 600;
    color: var(--meta);
    background: var(--border);
  }

  .book-info {
    padding: 12px 14px 14px;
  }

  .book-info h4 {
    font-family: 'Playfair Display', serif;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
    margin-bottom: 2px;
  }

  .book-info p {
    font-size: 12px;
    color: var(--meta);
    font-style: italic;
    margin-bottom: 6px;
  }

  .book-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }

  .book-tags span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--meta);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 3px;
  }

  .read-btn {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    border: 1px solid var(--text);
    background: transparent;
    color: var(--text);
    padding: 5px 16px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .read-btn:hover {
    background: var(--text);
    color: var(--bg);
  }

  .featured-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }

  .featured-card {
    cursor: pointer;
    border: 1px solid var(--card-border);
    border-radius: 6px;
    overflow: hidden;
    background: var(--card);
    transition: all 0.2s ease;
  }

  .featured-card:hover {
    border-color: var(--text);
    transform: translateY(-3px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.05);
  }

  .featured-cover {
    aspect-ratio: 2/3;
    background: var(--border);
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
    font-size: 28px;
    font-weight: 600;
    color: var(--meta);
    background: var(--border);
  }

  .featured-info {
    padding: 10px 14px 12px;
  }

  .featured-info h4 {
    font-family: 'Playfair Display', serif;
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .featured-info p {
    font-size: 12px;
    color: var(--meta);
    font-style: italic;
  }

  .continue-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px;
  }

  .continue-card {
    display: flex;
    gap: 12px;
    border: 1px solid var(--card-border);
    padding: 12px;
    border-radius: 6px;
    cursor: pointer;
    background: var(--card);
    transition: all 0.2s ease;
    position: relative;
    align-items: center;
  }

  .continue-card:hover {
    border-color: var(--text);
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.05);
  }

  .continue-cover {
    width: 44px;
    height: 60px;
    flex-shrink: 0;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .continue-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .continue-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Playfair Display', serif;
    font-size: 18px;
    font-weight: 600;
    color: var(--meta);
    background: var(--border);
  }

  .continue-info {
    flex: 1;
    min-width: 0;
  }

  .continue-info h4 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .continue-info p {
    font-size: 11px;
    color: var(--meta);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .continue-progress {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 2px;
  }

  .continue-progress-track {
    flex: 1;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .continue-progress-fill {
    height: 100%;
    background: var(--text);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .continue-progress span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: var(--meta);
    min-width: 30px;
    text-align: right;
  }

  .continue-info small {
    font-size: 10px;
    color: var(--meta);
  }

  .continue-remove {
    position: absolute;
    top: 4px;
    right: 6px;
    background: none;
    border: none;
    color: var(--meta);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .continue-remove:hover {
    background: var(--hover);
    color: var(--text);
  }

  .load-more {
    display: flex;
    justify-content: center;
    margin-top: 32px;
  }

  .load-more button {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    padding: 8px 24px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .load-more button:hover:not(:disabled) {
    border-color: var(--text);
    background: var(--text);
    color: var(--bg);
  }

  .load-more button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .footer {
    margin-top: 48px;
    padding: 32px 0 20px;
    border-top: 1px solid var(--border);
  }

  .footer-content {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 32px;
    max-width: 1040px;
    margin: 0 auto;
    padding: 0 24px;
  }

  .footer-content h4 {
    font-family: 'Playfair Display', serif;
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }

  .footer-content p {
    font-size: 13px;
    color: var(--meta);
    font-style: italic;
  }

  .footer-links {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }

  .footer-links h5 {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--meta);
    margin-bottom: 8px;
  }

  .footer-links button,
  .footer-links a {
    display: block;
    background: none;
    border: none;
    font-size: 13px;
    color: var(--meta);
    cursor: pointer;
    padding: 3px 0;
    text-decoration: none;
    transition: color 0.2s ease;
    font-family: 'Inter', sans-serif;
  }

  .footer-links button:hover,
  .footer-links a:hover {
    color: var(--text);
  }

  .footer-bottom {
    max-width: 1040px;
    margin: 24px auto 0;
    padding: 14px 24px 0;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .footer-bottom p {
    font-size: 12px;
    color: var(--meta);
  }

  .reader-wrapper {
    max-width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .reader-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 10px 24px 0;
  }

  .reader-header-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 8px;
  }

  .reader-back {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    padding: 4px 0;
    color: var(--text);
    transition: opacity 0.2s ease;
  }

  .reader-back:hover { opacity: 0.6; }

  .reader-header-title {
    font-size: 14px;
    font-weight: 500;
    flex: 1;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }

  .reader-header-actions {
    position: relative;
  }

  .reader-chapter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    border: 1px solid var(--border);
    background: none;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
    transition: all 0.15s ease;
  }

  .reader-chapter-btn:hover:not(:disabled) { background: var(--hover); }
  .reader-chapter-btn:disabled { opacity: 0.4; cursor: default; }

  .chapter-menu-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 6px;
    max-height: 300px;
    overflow-y: auto;
    width: 220px;
    z-index: 20;
    box-shadow: 0 8px 24px rgba(0,0,0,0.1);
  }

  .chapter-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    font-size: 13px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    padding: 8px 14px;
    cursor: pointer;
    color: var(--text);
    transition: all 0.1s ease;
  }

  .chapter-menu-item:last-child { border-bottom: none; }
  .chapter-menu-item:hover:not(.active) { background: var(--hover); }
  .chapter-menu-item.active {
    background: var(--text);
    color: var(--bg);
    border-radius: 6px 6px 0 0;
  }

  .reader-progress {
    padding: 0 0 8px;
  }

  .reader-progress-track {
    width: 100%;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .reader-progress-fill {
    height: 100%;
    transition: width 0.3s ease;
    border-radius: 2px;
  }

  .reader-body {
    padding: 20px 24px 100px;
    flex: 1;
  }

  .reader-loading {
    display: flex;
    justify-content: center;
    padding: 40px 0;
  }

  .shimmer-wrapper {
    width: 100%;
    max-width: 680px;
  }

  .shimmer-line {
    height: 16px;
    background: linear-gradient(90deg, var(--border) 25%, var(--hover) 50%, var(--border) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease infinite;
    border-radius: 4px;
    margin-bottom: 10px;
  }

  .shimmer-line.short { width: 60%; }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .reader-error {
    text-align: center;
    padding: 40px 0;
    color: var(--text);
  }

  .reader-content {
    max-width: 680px;
    margin: 0 auto;
  }

  .reader-chapter-label {
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--meta);
    margin-bottom: 6px;
  }

  .reader-text {
    font-family: 'Georgia', 'Times New Roman', serif;
    line-height: 1.8;
  }

  .reader-text p {
    margin: 0 0 1.1em;
    text-align: justify;
    color: var(--text);
  }

  .reader-text p:first-of-type::first-letter {
    font-size: 3em;
    float: left;
    line-height: 1;
    margin-right: 6px;
    margin-top: 4px;
    font-weight: 600;
  }

  .fade-in-text {
    animation: fadeInText 0.5s ease both;
  }

  @keyframes fadeInText {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .page-transition {
    animation: pageTurn 0.35s ease both;
  }

  @keyframes pageTurn {
    0% { opacity: 0; transform: translateX(16px) scale(0.98); }
    100% { opacity: 1; transform: translateX(0) scale(1); }
  }

  .reader-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 10px 20px;
    background: var(--bg);
    border-top: 1px solid var(--border);
    z-index: 10;
  }

  .reader-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 680px;
    margin: 0 auto;
  }

  .reader-controls-left,
  .reader-controls-center,
  .reader-controls-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .reader-nav-btn {
    font-size: 18px;
    border: 1px solid var(--border);
    background: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text);
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reader-nav-btn:hover:not(:disabled) { background: var(--hover); }
  .reader-nav-btn:disabled { opacity: 0.3; cursor: default; }

  .reader-page-info {
    font-size: 12px;
    color: var(--meta);
    min-width: 50px;
    text-align: center;
  }

  .reader-font-btn {
    font-size: 13px;
    font-weight: 600;
    border: 1px solid var(--border);
    background: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text);
    transition: all 0.15s ease;
  }

  .reader-font-btn:hover:not(:disabled) { background: var(--hover); }
  .reader-font-btn:disabled { opacity: 0.3; cursor: default; }

  .reader-font-size {
    font-size: 12px;
    color: var(--meta);
    min-width: 20px;
    text-align: center;
  }

  .reader-theme-btn,
  .reader-translate-btn {
    font-size: 14px;
    border: 1px solid var(--border);
    background: none;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text);
    transition: all 0.15s ease;
  }

  .reader-theme-btn:hover,
  .reader-translate-btn:hover:not(:disabled) { background: var(--hover); }
  .reader-translate-btn:disabled { opacity: 0.3; cursor: default; }

  @media (max-width: 768px) {
    .hero h2 { font-size: 28px; }
    .featured-grid { grid-template-columns: repeat(2, 1fr); }
    .book-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    .footer-content { grid-template-columns: 1fr; gap: 20px; }
    .footer-links { grid-template-columns: repeat(3, 1fr); }
    .reader-body { padding: 16px 16px 90px; }
    .reader-header { padding: 8px 16px 0; }
    .reader-header-title { font-size: 12px; }
    .reader-back span { display: none; }
    .reader-footer { padding: 8px 14px; }
    .catalog { padding: 20px 16px 40px; }
  }

  @media (max-width: 480px) {
    .book-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
    .featured-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .continue-grid { grid-template-columns: 1fr; }
    .hero h2 { font-size: 22px; }
    .hero p { font-size: 13px; }
    .catalog-header h1 { font-size: 20px; }
    .footer-links { grid-template-columns: 1fr 1fr; }
    .reader-text p:first-of-type::first-letter { font-size: 2.4em; }
  }
`;

export default App;