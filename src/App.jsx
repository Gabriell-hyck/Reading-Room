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

  const [fontSize, setFontSize] = useState(18);
  const [readerTheme, setReaderTheme] = useState('light');

  const [history, setHistory] = useState([]);
  const [continueBooks, setContinueBooks] = useState([]);

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

  // Load history dari localStorage
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

  // Simpan progress ke history
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
    setChapterIndex(i);
    setMenuOpen(false);
    setShowTranslation(false);
    
    if (selectedBook && chapters.length > 0) {
      saveProgress(selectedBook, i, chapters.length);
    }
    
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

          {/* CONTINUE READING */}
          {!loading && !error && continueBooks.length > 0 && (
            <>
              <div className="section-header">
                <h2 className="section-title">Continue Reading</h2>
                {history.length > 4 && (
                  <button className="section-more-btn" onClick={scrollToAllBooks}>
                    View all →
                  </button>
                )}
              </div>
              <div className="continue-grid">
                {continueBooks.map((book) => (
                  <div 
                    className="continue-card" 
                    key={book.id} 
                    onClick={() => {
                      fetch(`https://gutendex.com/books/${book.id}`)
                        .then(res => res.json())
                        .then(data => {
                          if (data && data.id) {
                            openBook(data);
                          }
                        })
                        .catch(err => console.error('Failed to fetch book:', err));
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
                      <h3 className="continue-title">{book.title}</h3>
                      <p className="continue-author">{book.author}</p>
                      <div className="continue-progress">
                        <div className="continue-progress-track">
                          <div 
                            className="continue-progress-fill" 
                            style={{ width: `${book.progress}%` }}
                          />
                        </div>
                        <span className="continue-progress-text">{book.progress}%</span>
                      </div>
                      <p className="continue-chapter">Chapter {book.lastChapter} of {book.totalChapters}</p>
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
              <div className="rule-double" />
            </>
          )}

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
                <button className="section-more-btn" onClick={scrollToAllBooks}>
                  Browse all →
                </button>
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
              <div className="section-header all-books-section" id="all-books">
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
        <div className="reader-wrapper" style={{ backgroundColor: theme.background }}>
          {/* READER HEADER */}
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
                <div 
                  className="reader-progress-fill" 
                  style={{ 
                    width: chapters.length > 0 ? `${((chapterIndex + 1) / chapters.length) * 100}%` : '0%',
                    backgroundColor: theme.color
                  }} 
                />
              </div>
            </div>
          </div>

          {/* READER BODY */}
          <div className="reader-body" style={{ backgroundColor: theme.background }}>
            {textLoading && (
              <div className="reader-loading">
                <p style={{ color: theme.metaColor }}>Loading text...</p>
                <span className="loading-dots"><span></span><span></span><span></span></span>
              </div>
            )}
            {textError && <p className="reader-error" style={{ color: theme.color }}>{textError}</p>}

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
                      .filter((p) => p.trim().length > 0)
                      .map((p, i) => (
                        <p key={i}>{p.replace(/\s+/g, " ").trim()}</p>
                      ));
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* READER FOOTER */}
          <div className="reader-footer" style={{ backgroundColor: theme.background, borderTop: `1px solid ${theme.borderColor}` }}>
            <div className="reader-controls">
              <div className="reader-controls-left">
                <button 
                  className="reader-nav-btn" 
                  onClick={() => goToChapter(chapterIndex - 1)} 
                  disabled={chapterIndex === 0}
                  style={{ color: theme.color, borderColor: theme.borderColor }}
                >
                  ←
                </button>
                <span className="reader-page-info" style={{ color: theme.metaColor }}>
                  {chapterIndex + 1} / {chapters.length}
                </span>
                <button 
                  className="reader-nav-btn" 
                  onClick={() => goToChapter(chapterIndex + 1)} 
                  disabled={chapterIndex === chapters.length - 1}
                  style={{ color: theme.color, borderColor: theme.borderColor }}
                >
                  →
                </button>
              </div>
              <div className="reader-controls-center">
                <button className="reader-font-btn" onClick={decreaseFont} disabled={fontSize <= 14} style={{ color: theme.color, borderColor: theme.borderColor }}>
                  A−
                </button>
                <span className="reader-font-size" style={{ color: theme.metaColor }}>{fontSize}</span>
                <button className="reader-font-btn" onClick={increaseFont} disabled={fontSize >= 26} style={{ color: theme.color, borderColor: theme.borderColor }}>
                  A+
                </button>
              </div>
              <div className="reader-controls-right">
                <button 
                  className="reader-theme-btn" 
                  onClick={toggleTheme}
                  style={{ color: theme.color, borderColor: theme.borderColor }}
                >
                  {readerTheme === 'light' ? '' : readerTheme === 'sepia' ? '' : ''}
                </button>
                <button 
                  className="reader-translate-btn"
                  onClick={showTranslation ? toggleTranslation : handleTranslate}
                  disabled={translating || chapters.length === 0}
                  style={{ color: theme.color, borderColor: theme.borderColor }}
                >
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

  .catalog, .reader-wrapper {
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

  /* CONTINUE READING */
  .continue-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
    margin-bottom: 8px;
  }

  .continue-card {
    display: flex;
    gap: 12px;
    border: 1px solid #e8e8e8;
    padding: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
    background: #ffffff;
    position: relative;
    border-radius: 4px;
    align-items: center;
  }

  .continue-card:hover {
    border-color: #0d0d0d;
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  }

  .continue-cover {
    width: 48px;
    height: 64px;
    flex-shrink: 0;
    background: #f5f5f5;
    border-radius: 2px;
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
    color: #d0d0d0;
    background: #f5f5f5;
  }

  .continue-info {
    flex: 1;
    min-width: 0;
  }

  .continue-title {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 2px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .continue-author {
    font-family: 'Inter', sans-serif;
    font-size: 11px;
    color: #6e6e6e;
    margin: 0 0 6px;
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .continue-progress {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .continue-progress-track {
    flex: 1;
    height: 3px;
    background: #e8e8e8;
    border-radius: 2px;
    overflow: hidden;
  }

  .continue-progress-fill {
    height: 100%;
    background: #0d0d0d;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .continue-progress-text {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: #6e6e6e;
    min-width: 32px;
    text-align: right;
  }

  .continue-chapter {
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    color: #9a9a9a;
    margin: 2px 0 0;
  }

  .continue-remove {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    color: #b0b0b0;
    font-size: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    padding: 0;
    line-height: 1;
  }

  .continue-remove:hover {
    background: #f0f0f0;
    color: #0d0d0d;
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

  .section-more-btn {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #6e6e6e;
    cursor: pointer;
    letter-spacing: 0.04em;
    border: none;
    background: none;
    padding: 0;
    transition: color 0.15s ease;
  }

  .section-more-btn:hover {
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

  /* READER - GOOGLE PLAY STYLE */
  .reader-wrapper {
    padding: 0;
    max-width: 100%;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .reader-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 12px 24px 0;
  }

  .reader-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
  }

  .reader-back {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 500;
    border: none;
    background: none;
    cursor: pointer;
    padding: 4px 0;
    color: #1a1a1a;
    transition: opacity 0.15s ease;
  }

  .reader-back:hover {
    opacity: 0.6;
  }

  .reader-header-title {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    font-weight: 500;
    flex: 1;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reader-header-actions {
    position: relative;
    display: flex;
    align-items: center;
  }

  .reader-chapter-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    border: 1px solid #e8e8e8;
    background: none;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 4px;
    color: #1a1a1a;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .reader-chapter-btn:hover:not(:disabled) {
    background: #f0f0f0;
  }

  .reader-chapter-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .chapter-menu-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    background: #ffffff;
    border: 1px solid #e8e8e8;
    border-radius: 8px;
    max-height: 320px;
    overflow-y: auto;
    width: 240px;
    z-index: 20;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
  }

  .chapter-menu-dropdown .chapter-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    background: none;
    border: none;
    border-bottom: 1px solid #f0f0f0;
    padding: 10px 16px;
    cursor: pointer;
    color: #1a1a1a;
    transition: all 0.1s ease;
  }

  .chapter-menu-dropdown .chapter-menu-item:last-child {
    border-bottom: none;
  }

  .chapter-menu-dropdown .chapter-menu-item:hover:not(.active) {
    background: #f5f5f5;
  }

  .chapter-menu-dropdown .chapter-menu-item.active {
    background: #1a1a1a;
    color: #ffffff;
    border-radius: 8px 8px 0 0;
  }

  .reader-progress {
    padding: 0 0 12px;
  }

  .reader-progress-track {
    width: 100%;
    height: 3px;
    background: #e8e8e8;
    border-radius: 2px;
    overflow: hidden;
  }

  .reader-progress-fill {
    height: 100%;
    background: #1a1a1a;
    transition: width 0.3s ease;
    border-radius: 2px;
  }

  .reader-body {
    padding: 24px 24px 120px;
    min-height: 70vh;
    flex: 1;
  }

  .reader-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    color: #888;
    justify-content: center;
    padding: 60px 0;
  }

  .reader-error {
    font-family: 'Inter', sans-serif;
    font-size: 14px;
    color: #1a1a1a;
    text-align: center;
    padding: 60px 0;
  }

  .reader-content {
    max-width: 680px;
    margin: 0 auto;
  }

  .reader-chapter-label {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #888;
    margin-bottom: 8px;
  }

  .reader-text {
    font-family: 'Georgia', 'Times New Roman', serif;
    line-height: 1.8;
  }

  .reader-text p {
    margin: 0 0 1.2em;
    text-align: justify;
  }

  .reader-text p:first-of-type::first-letter {
    font-size: 3.2em;
    float: left;
    line-height: 1;
    margin-right: 6px;
    margin-top: 4px;
    font-weight: 600;
  }

  .reader-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 12px 24px;
    background: #ffffff;
    border-top: 1px solid #e8e8e8;
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
    gap: 6px;
  }

  .reader-nav-btn {
    font-family: 'Inter', sans-serif;
    font-size: 18px;
    border: 1px solid #e8e8e8;
    background: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1a1a1a;
    transition: all 0.15s ease;
  }

  .reader-nav-btn:hover:not(:disabled) {
    background: #f0f0f0;
  }

  .reader-nav-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .reader-page-info {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    color: #888;
    min-width: 56px;
    text-align: center;
  }

  .reader-font-btn {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid #e8e8e8;
    background: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;
    color: #1a1a1a;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reader-font-btn:hover:not(:disabled) {
    background: #f0f0f0;
  }

  .reader-font-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .reader-font-size {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    color: #888;
    min-width: 24px;
    text-align: center;
  }

  .reader-theme-btn,
  .reader-translate-btn {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    border: 1px solid #e8e8e8;
    background: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    color: #1a1a1a;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reader-theme-btn:hover,
  .reader-translate-btn:hover:not(:disabled) {
    background: #f0f0f0;
  }

  .reader-translate-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  @media (max-width: 820px) {
    .catalog {
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
      padding: 16px 16px 100px;
    }
  }

  @media (max-width: 640px) {
    .catalog {
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

    .continue-grid {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .continue-card {
      padding: 10px;
    }

    .continue-cover {
      width: 40px;
      height: 56px;
    }

    .continue-title {
      font-size: 12px;
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

    .reader-header {
      padding: 8px 16px 0;
    }

    .reader-header-title {
      font-size: 12px;
    }

    .reader-back span {
      display: none;
    }

    .reader-chapter-btn {
      font-size: 11px;
      padding: 3px 10px;
    }

    .reader-body {
      padding: 16px 16px 100px;
    }

    .reader-text {
      font-size: 16px;
    }

    .reader-text p:first-of-type::first-letter {
      font-size: 2.6em;
    }

    .reader-footer {
      padding: 10px 16px;
    }

    .reader-nav-btn {
      width: 32px;
      height: 32px;
      font-size: 16px;
    }

    .reader-font-btn {
      width: 28px;
      height: 28px;
      font-size: 12px;
    }

    .reader-theme-btn,
    .reader-translate-btn {
      width: 32px;
      height: 32px;
      font-size: 12px;
    }

    .reader-page-info {
      font-size: 11px;
      min-width: 44px;
    }

    .reader-font-size {
      font-size: 11px;
      min-width: 20px;
    }

    .chapter-menu-dropdown {
      width: 200px;
      right: -10px;
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
  }
`;
