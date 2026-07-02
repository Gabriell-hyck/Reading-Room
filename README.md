Reading Room

yo what's good, this is Reading Room - a public domain book reader and catalog app built with React. it pulls books from Project Gutenberg through the Gutendex API so you can read classic literature right in your browser.

what it does

browse through thousands of public domain books, search by title or author, filter by genre, and read them right here. the app splits books into chapters automatically so you don't lose your place.

features

```
· catalog view with all them books
· search by title or author
· genre filters (fiction, romance, mystery, horror, sci-fi, philosophy, poetry, drama, history, and more)
· infinite scroll with load more button
· built-in reader with chapter navigation 
· automatic chapter detection from text
· fallback text fetching if the main source fails
· clean typewriter-inspired design
```

how it works

the app hits the Gutendex API to get book metadata, then fetches the actual text from Project Gutenberg mirrors. it strips out the boilerplate text they add at the start and end, then detects chapter headings to split the book into readable chunks.

if a book has no clear chapter structure, it splits the text into parts of roughly 2500 words each so you still get manageable reading sections.

tech stack

· react 18
· vite for bundling
· lucide-react for icons
· Gutendex API for book data
· Project Gutenberg for text content

setup

clone the repo and install dependencies

```
npm install
```

run it locally

```
npm run dev
```

build for production

```
npm run build
```

preview the build

```
npm run preview
```

deploy

this thing works great on Vercel. just push to GitHub and connect your repo, or use the CLI.

```
vercel --prod
```

credits

books come from Project Gutenberg via the Gutendex API. all texts are in the public domain.

license

ISC

---

thats it. go read some books or whatever
