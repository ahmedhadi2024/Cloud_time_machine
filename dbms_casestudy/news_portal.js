// =====================================================================
//  BCSE302L - DATABASE SYSTEMS | Case Study using MongoDB (D2 Slot)
//  Topic : News Portal
//  Run section by section in mongosh (or MongoDB Compass > mongosh tab)
//  and take a screenshot of the output after each operation.
// =====================================================================


// ---------------------------------------------------------------------
// TASK 4: DATABASE CREATION
// ---------------------------------------------------------------------
use newsPortalDB

db.createCollection("categories")
db.createCollection("authors")
db.createCollection("articles")
db.createCollection("readers")
db.createCollection("comments")

show collections


// ---------------------------------------------------------------------
// TASK 5: CREATE OPERATIONS
// ---------------------------------------------------------------------

// 5.1 insertOne() - a single category
db.categories.insertOne({
  _id: "CAT01",
  name: "Politics",
  slug: "politics",
  description: "National and international political news",
  isActive: true,
  createdAt: new Date("2025-01-10")
})

// 5.2 insertMany() - remaining categories
db.categories.insertMany([
  { _id: "CAT02", name: "Technology",    slug: "technology",    description: "Gadgets, software, AI and startups",        isActive: true,  createdAt: new Date("2025-01-10") },
  { _id: "CAT03", name: "Sports",        slug: "sports",        description: "Cricket, football and other sports",        isActive: true,  createdAt: new Date("2025-01-12") },
  { _id: "CAT04", name: "Business",      slug: "business",      description: "Markets, economy and corporate news",       isActive: true,  createdAt: new Date("2025-01-12") },
  { _id: "CAT05", name: "Health",        slug: "health",        description: "Medicine, fitness and public health",       isActive: true,  createdAt: new Date("2025-02-01") },
  { _id: "CAT06", name: "Entertainment", slug: "entertainment", description: "Movies, music and celebrity news",          isActive: true,  createdAt: new Date("2025-02-01") },
  { _id: "CAT07", name: "Science",       slug: "science",       description: "Space, research and discoveries",           isActive: true,  createdAt: new Date("2025-03-05") },
  { _id: "CAT08", name: "Education",     slug: "education",     description: "Exams, universities and policy",            isActive: false, createdAt: new Date("2025-03-05") }
])

// 5.3 insertMany() - authors (social links embedded as a sub-document)
db.authors.insertMany([
  { _id: "AUT01", name: "Priya Raman",     email: "priya.raman@newsportal.in",   bio: "Senior political correspondent",      expertise: ["Politics", "Elections"],        social: { twitter: "@priyaraman",  linkedin: "in/priyaraman" },  isVerified: true,  joinedOn: new Date("2022-06-15"), articleCount: 142 },
  { _id: "AUT02", name: "Arjun Mehta",     email: "arjun.mehta@newsportal.in",   bio: "Covers AI, startups and gadgets",     expertise: ["Technology", "AI", "Startups"], social: { twitter: "@arjuntech",   linkedin: "in/arjunmehta" },  isVerified: true,  joinedOn: new Date("2023-01-20"), articleCount: 98 },
  { _id: "AUT03", name: "Sneha Kulkarni",  email: "sneha.k@newsportal.in",       bio: "Cricket and football analyst",        expertise: ["Sports", "Cricket"],            social: { twitter: "@snehasports", linkedin: null },             isVerified: false, joinedOn: new Date("2024-03-11"), articleCount: 57 },
  { _id: "AUT04", name: "Rahul Nair",      email: "rahul.nair@newsportal.in",    bio: "Markets and economy reporter",        expertise: ["Business", "Economy"],          social: { twitter: "@rahulmarkets",linkedin: "in/rahulnair" },   isVerified: true,  joinedOn: new Date("2021-09-01"), articleCount: 210 },
  { _id: "AUT05", name: "Dr. Fathima Ali", email: "fathima.ali@newsportal.in",   bio: "Physician and health columnist",      expertise: ["Health", "Science"],            social: { twitter: null,           linkedin: "in/drfathima" },   isVerified: true,  joinedOn: new Date("2023-07-25"), articleCount: 44 },
  { _id: "AUT06", name: "Karthik Iyer",    email: "karthik.iyer@newsportal.in",  bio: "Film critic and entertainment writer",expertise: ["Entertainment"],                social: { twitter: "@karthikfilms",linkedin: null },             isVerified: false, joinedOn: new Date("2024-11-02"), articleCount: 31 },
  { _id: "AUT07", name: "Ananya Das",      email: "ananya.das@newsportal.in",    bio: "Space and science reporter",          expertise: ["Science", "Space", "AI"],       social: { twitter: "@ananyaspace", linkedin: "in/ananyadas" },   isVerified: true,  joinedOn: new Date("2022-02-14"), articleCount: 76 },
  { _id: "AUT08", name: "Vikram Singh",    email: "vikram.singh@newsportal.in",  bio: "Political analyst and editor",        expertise: ["Politics", "Business"],         social: { twitter: "@vikrampol",   linkedin: "in/vikramsingh" }, isVerified: true,  joinedOn: new Date("2020-05-30"), articleCount: 305 }
])

// 5.4 insertMany() - articles (authorId & categoryId are REFERENCES,
//     media and location are EMBEDDED sub-documents, tags is an array)
db.articles.insertMany([
  { _id: "ART01", title: "India Announces New AI Policy Framework",           slug: "india-ai-policy-framework",   summary: "Government releases national guidelines for responsible AI.",       content: "The Ministry of Electronics and IT released a framework ...", authorId: "AUT02", categoryId: "CAT02", tags: ["AI", "policy", "India"],          status: "published", publishedAt: new Date("2026-10-02"), views: 15420, likes: 980, readTimeMin: 6, isFeatured: false, media: { coverImage: "ai_policy.jpg",   caption: "Delegates at the policy launch" }, location: { city: "New Delhi", country: "India" } },
  { _id: "ART02", title: "State Elections: Voter Turnout Hits Record High",   slug: "state-elections-record-turnout", summary: "Highest turnout in two decades recorded across districts.",     content: "Election officials reported a turnout of 78 percent ...",    authorId: "AUT01", categoryId: "CAT01", tags: ["elections", "voting", "India"],    status: "published", publishedAt: new Date("2026-10-05"), views: 22310, likes: 1450, readTimeMin: 5, isFeatured: false, media: { coverImage: "voters.jpg",     caption: "Voters queue outside a polling booth" }, location: { city: "Chennai", country: "India" } },
  { _id: "ART03", title: "India Clinch T20 Series Against Australia",         slug: "india-t20-series-win",        summary: "A last-over thriller seals the series 3-2.",                      content: "Chasing 186, India needed 12 off the final over ...",        authorId: "AUT03", categoryId: "CAT03", tags: ["cricket", "T20", "India"],         status: "published", publishedAt: new Date("2026-10-08"), views: 31050, likes: 2600, readTimeMin: 4, isFeatured: true,  media: { coverImage: "t20_win.jpg",    caption: "Team celebrates the series win" }, location: { city: "Mumbai", country: "India" } },
  { _id: "ART04", title: "Sensex Crosses 90,000 for the First Time",          slug: "sensex-crosses-90000",        summary: "Banking and IT stocks drive a historic rally.",                   content: "The BSE Sensex closed at a record high on Friday ...",       authorId: "AUT04", categoryId: "CAT04", tags: ["markets", "stocks", "economy"],    status: "published", publishedAt: new Date("2026-09-26"), views: 8740,  likes: 410, readTimeMin: 3, isFeatured: false, media: { coverImage: "sensex.jpg",     caption: "Trading screens at BSE" }, location: { city: "Mumbai", country: "India" } },
  { _id: "ART05", title: "Monsoon Season Sees Rise in Dengue Cases",          slug: "monsoon-dengue-cases",        summary: "Doctors urge preventive measures as cases climb.",               content: "Hospitals across the state reported a 30 percent rise ...",  authorId: "AUT05", categoryId: "CAT05", tags: ["dengue", "public health", "monsoon"], status: "published", publishedAt: new Date("2026-09-18"), views: 6120,  likes: 255, readTimeMin: 5, isFeatured: false, media: { coverImage: "dengue.jpg",     caption: "Fogging drive in a residential area" }, location: { city: "Kochi", country: "India" } },
  { _id: "ART06", title: "Box Office: Pan-Indian Film Crosses 500 Crore",     slug: "film-crosses-500-crore",      summary: "The action drama becomes the year's biggest hit.",                content: "In its third week, the film continued strong collections ...", authorId: "AUT06", categoryId: "CAT06", tags: ["box office", "cinema"],             status: "published", publishedAt: new Date("2026-10-11"), views: 12890, likes: 870, readTimeMin: 3, isFeatured: false, media: { coverImage: "boxoffice.jpg",  caption: "Fans outside a theatre" }, location: { city: "Hyderabad", country: "India" } },
  { _id: "ART07", title: "ISRO Successfully Tests Reusable Launch Vehicle",   slug: "isro-reusable-launch-vehicle", summary: "The landing experiment marks a key milestone.",                  content: "ISRO's reusable launch vehicle completed an autonomous landing ...", authorId: "AUT07", categoryId: "CAT07", tags: ["ISRO", "space", "India"],       status: "published", publishedAt: new Date("2026-10-14"), views: 18760, likes: 1720, readTimeMin: 7, isFeatured: false, media: { coverImage: "isro_rlv.jpg",   caption: "RLV on the runway after landing" }, location: { city: "Bengaluru", country: "India" } },
  { _id: "ART08", title: "Parliament Debates Digital Data Protection Rules",  slug: "parliament-data-protection",  summary: "Opposition raises concerns over consent provisions.",            content: "The winter session opened with a heated debate ...",         authorId: "AUT08", categoryId: "CAT01", tags: ["policy", "privacy", "parliament"], status: "published", publishedAt: new Date("2026-10-20"), views: 4310,  likes: 190, readTimeMin: 6, isFeatured: false, media: { coverImage: "parliament.jpg", caption: "Parliament house" }, location: { city: "New Delhi", country: "India" } },
  { _id: "ART09", title: "Startups Turn to Generative AI for Customer Support", slug: "startups-genai-support",   summary: "Indian startups report lower costs after adopting AI agents.",   content: "A survey of 200 startups found that ...",                    authorId: "AUT02", categoryId: "CAT02", tags: ["AI", "startups"],                  status: "published", publishedAt: new Date("2026-10-22"), views: 2980,  likes: 140, readTimeMin: 4, isFeatured: false, media: { coverImage: "genai.jpg",      caption: "A support team at work" }, location: { city: "Bengaluru", country: "India" } },
  { _id: "ART10", title: "Draft: Budget Expectations for Salaried Class",     slug: "budget-expectations-draft",   summary: "What taxpayers want from the upcoming budget.",                  content: "Work in progress ...",                                       authorId: "AUT04", categoryId: "CAT04", tags: ["budget", "tax"],                   status: "draft",     publishedAt: null,                       views: 0,     likes: 0,   readTimeMin: 5, isFeatured: false, media: { coverImage: null,             caption: null }, location: { city: "Mumbai", country: "India" } }
])

// 5.5 insertMany() - readers (preferences & subscription EMBEDDED,
//     bookmarks is an array of article references)
db.readers.insertMany([
  { _id: "RDR01", name: "Aditya Sharma",  email: "aditya.s@gmail.com",   city: "Chennai",   preferences: { categories: ["CAT02", "CAT03"], newsletter: true  }, subscription: { plan: "premium", startDate: new Date("2026-04-01"), endDate: new Date("2026-12-31") }, registeredOn: new Date("2025-08-10"), bookmarks: ["ART01", "ART03"] },
  { _id: "RDR02", name: "Meera Pillai",   email: "meera.p@gmail.com",    city: "Kochi",     preferences: { categories: ["CAT05"],          newsletter: false }, subscription: { plan: "free",    startDate: new Date("2025-11-12"), endDate: null },                     registeredOn: new Date("2025-11-12"), bookmarks: ["ART05"] },
  { _id: "RDR03", name: "Rohan Gupta",    email: "rohan.g@yahoo.com",    city: "New Delhi", preferences: { categories: ["CAT01", "CAT04"], newsletter: true  }, subscription: { plan: "premium", startDate: new Date("2026-01-15"), endDate: new Date("2027-01-14") }, registeredOn: new Date("2024-12-01"), bookmarks: ["ART02", "ART08"] },
  { _id: "RDR04", name: "Divya Krishnan", email: "divya.k@outlook.com",  city: "Chennai",   preferences: { categories: ["CAT06"],          newsletter: false }, subscription: { plan: "free",    startDate: new Date("2026-02-20"), endDate: null },                     registeredOn: new Date("2026-02-20"), bookmarks: [] },
  { _id: "RDR05", name: "Sameer Khan",    email: "sameer.k@gmail.com",   city: "Hyderabad", preferences: { categories: ["CAT02", "CAT07"], newsletter: false }, subscription: { plan: "premium", startDate: new Date("2026-06-01"), endDate: new Date("2026-11-30") }, registeredOn: new Date("2025-05-05"), bookmarks: ["ART07", "ART09"] },
  { _id: "RDR06", name: "Lakshmi Menon",  email: "lakshmi.m@gmail.com",  city: "Bengaluru", preferences: { categories: ["CAT07", "CAT05"], newsletter: true  }, subscription: { plan: "free",    startDate: new Date("2026-03-03"), endDate: null },                     registeredOn: new Date("2026-03-03"), bookmarks: ["ART07"] },
  { _id: "RDR07", name: "Nikhil Joshi",   email: "nikhil.j@gmail.com",   city: "Mumbai",    preferences: { categories: ["CAT03", "CAT04"], newsletter: true  }, subscription: { plan: "premium", startDate: new Date("2025-10-10"), endDate: new Date("2026-10-09") }, registeredOn: new Date("2025-10-10"), bookmarks: ["ART03", "ART04"] },
  { _id: "RDR08", name: "Farah Siddiqui", email: "farah.s@gmail.com",    city: "Chennai",   preferences: { categories: ["CAT01", "CAT02"], newsletter: false }, subscription: { plan: "free",    startDate: new Date("2026-07-07"), endDate: null },                     registeredOn: new Date("2026-07-07"), bookmarks: ["ART02"] }
])

// 5.6 insertMany() - comments (articleId & readerId are REFERENCES,
//     replies are EMBEDDED as an array of sub-documents)
db.comments.insertMany([
  { _id: "CMT01", articleId: "ART03", readerId: "RDR01", text: "What a finish! Best match of the year.",            postedAt: new Date("2026-10-08T21:10:00"), likes: 54, isFlagged: false, replies: [ { readerId: "RDR07", text: "Agreed, that last over was unreal.", postedAt: new Date("2026-10-08T21:30:00") } ] },
  { _id: "CMT02", articleId: "ART01", readerId: "RDR05", text: "Good step, but enforcement will be the real test.", postedAt: new Date("2026-10-02T12:00:00"), likes: 31, isFlagged: false, replies: [] },
  { _id: "CMT03", articleId: "ART02", readerId: "RDR03", text: "Great to see youth participation rising.",          postedAt: new Date("2026-10-05T18:45:00"), likes: 22, isFlagged: false, replies: [ { readerId: "RDR08", text: "Especially first-time voters.", postedAt: new Date("2026-10-05T19:05:00") } ] },
  { _id: "CMT04", articleId: "ART07", readerId: "RDR06", text: "Proud moment for Indian science!",                  postedAt: new Date("2026-10-14T10:20:00"), likes: 67, isFlagged: false, replies: [] },
  { _id: "CMT05", articleId: "ART05", readerId: "RDR02", text: "Our area hasn't had fogging in weeks.",             postedAt: new Date("2026-09-19T08:15:00"), likes: 12, isFlagged: false, replies: [] },
  { _id: "CMT06", articleId: "ART06", readerId: "RDR04", text: "Overrated movie honestly.",                         postedAt: new Date("2026-10-12T22:00:00"), likes: 3,  isFlagged: false, replies: [ { readerId: "RDR01", text: "The songs were good though.", postedAt: new Date("2026-10-12T22:40:00") } ] },
  { _id: "CMT07", articleId: "ART06", readerId: "RDR08", text: "CLICK HERE FOR FREE MOVIE DOWNLOADS!!!",            postedAt: new Date("2026-10-13T03:12:00"), likes: 0,  isFlagged: true,  replies: [] },
  { _id: "CMT08", articleId: "ART04", readerId: "RDR07", text: "Is this rally sustainable?",                        postedAt: new Date("2026-09-26T16:30:00"), likes: 9,  isFlagged: false, replies: [] },
  { _id: "CMT09", articleId: "ART08", readerId: "RDR03", text: "Consent rules need to be much clearer.",            postedAt: new Date("2026-10-20T14:10:00"), likes: 18, isFlagged: false, replies: [] },
  { _id: "CMT10", articleId: "ART03", readerId: "RDR04", text: "Buy cheap followers at spam-link dot com",          postedAt: new Date("2026-10-09T02:00:00"), likes: 0,  isFlagged: true,  replies: [] }
])

// Verify counts
db.categories.countDocuments()
db.authors.countDocuments()
db.articles.countDocuments()
db.readers.countDocuments()
db.comments.countDocuments()


// ---------------------------------------------------------------------
// TASK 6: READ OPERATIONS
// ---------------------------------------------------------------------

// R1. Filter + projection + sort:
//     Published Technology articles, showing only title, views, publishedAt,
//     most viewed first
db.articles.find(
  { categoryId: "CAT02", status: "published" },
  { _id: 0, title: 1, views: 1, publishedAt: 1 }
).sort({ views: -1 })

// R2. Comparison operators:
//     Popular articles - more than 10,000 views AND at least 1,000 likes
db.articles.find(
  { views: { $gt: 10000 }, likes: { $gte: 1000 } },
  { _id: 0, title: 1, views: 1, likes: 1 }
)

// R3. Array query with $in:
//     Articles tagged "AI" or "elections"
db.articles.find(
  { tags: { $in: ["AI", "elections"] } },
  { _id: 0, title: 1, tags: 1 }
)

// R4. Sort + limit:
//     Top 3 most-read articles (trending section of the homepage)
db.articles.find({}, { _id: 0, title: 1, views: 1 })
  .sort({ views: -1 })
  .limit(3)

// R5. Date range:
//     Articles published between 1 Oct 2026 and 15 Oct 2026
db.articles.find(
  { publishedAt: { $gte: new Date("2026-10-01"), $lte: new Date("2026-10-15") } },
  { _id: 0, title: 1, publishedAt: 1 }
).sort({ publishedAt: 1 })

// R6. Query on embedded fields (dot notation):
//     Premium readers whose subscription expires before 2027
db.readers.find(
  { "subscription.plan": "premium", "subscription.endDate": { $lt: new Date("2027-01-01") } },
  { _id: 0, name: 1, email: 1, "subscription.endDate": 1 }
)

// R7. Array element match + boolean filter:
//     Verified authors who write on Politics
db.authors.find(
  { expertise: "Politics", isVerified: true },
  { _id: 0, name: 1, expertise: 1, articleCount: 1 }
)

// R8. Regex (case-insensitive search box):
//     Articles whose title contains "india"
db.articles.find(
  { title: { $regex: "india", $options: "i" } },
  { _id: 0, title: 1 }
)

// R9. $or + array existence:
//     Comments that are flagged OR have at least one reply
db.comments.find(
  { $or: [ { isFlagged: true }, { "replies.0": { $exists: true } } ] },
  { _id: 1, text: 1, isFlagged: 1, replies: 1 }
)

// R10. Count:
//      How many articles are still drafts
db.articles.countDocuments({ status: "draft" })

// R11. Aggregation - $lookup (join references):
//      Each article with its author name and category name
db.articles.aggregate([
  { $match: { status: "published" } },
  { $lookup: { from: "authors",    localField: "authorId",   foreignField: "_id", as: "author" } },
  { $lookup: { from: "categories", localField: "categoryId", foreignField: "_id", as: "category" } },
  { $project: { _id: 0, title: 1, author: { $arrayElemAt: ["$author.name", 0] }, category: { $arrayElemAt: ["$category.name", 0] }, views: 1 } },
  { $sort: { views: -1 } }
])

// R12. Aggregation - $group:
//      Total views and number of articles per category
db.articles.aggregate([
  { $group: { _id: "$categoryId", totalArticles: { $sum: 1 }, totalViews: { $sum: "$views" } } },
  { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
  { $project: { _id: 0, category: { $arrayElemAt: ["$cat.name", 0] }, totalArticles: 1, totalViews: 1 } },
  { $sort: { totalViews: -1 } }
])


// ---------------------------------------------------------------------
// TASK 7: UPDATE OPERATIONS
// ---------------------------------------------------------------------

// U1. updateOne() with $inc:
//     A reader opened ART09 - increase its views by 1 and likes by 1
db.articles.updateOne(
  { _id: "ART09" },
  { $inc: { views: 1, likes: 1 } }
)
db.articles.find({ _id: "ART09" }, { title: 1, views: 1, likes: 1 })

// U2. updateMany() with $set:
//     Mark every article with more than 15,000 views as featured
db.articles.updateMany(
  { views: { $gt: 15000 } },
  { $set: { isFeatured: true } }
)
db.articles.find({ isFeatured: true }, { _id: 0, title: 1, views: 1, isFeatured: 1 })

// U3. updateOne() with $set + $currentDate:
//     Publish the draft budget article
db.articles.updateOne(
  { _id: "ART10" },
  { $set: { status: "published", title: "Budget 2027: What the Salaried Class Expects" },
    $currentDate: { publishedAt: true } }
)
db.articles.find({ _id: "ART10" }, { title: 1, status: 1, publishedAt: 1 })

// U4. updateOne() with $addToSet (array, no duplicates):
//     Add a new tag to the ISRO article
db.articles.updateOne(
  { _id: "ART07" },
  { $addToSet: { tags: "technology" } }
)
db.articles.find({ _id: "ART07" }, { title: 1, tags: 1 })

// U5. updateOne() with $push into an embedded array:
//     A reader replies to comment CMT02
db.comments.updateOne(
  { _id: "CMT02" },
  { $push: { replies: { readerId: "RDR03", text: "True, rules mean nothing without audits.", postedAt: new Date() } } }
)
db.comments.find({ _id: "CMT02" })

// U6. updateMany() on embedded field:
//     Premium subscriptions that already expired are downgraded to free
db.readers.updateMany(
  { "subscription.plan": "premium", "subscription.endDate": { $lt: new Date() } },
  { $set: { "subscription.plan": "free", "subscription.endDate": null } }
)
db.readers.find({}, { _id: 0, name: 1, "subscription.plan": 1, "subscription.endDate": 1 })


// ---------------------------------------------------------------------
// TASK 8: DELETE OPERATIONS
// ---------------------------------------------------------------------

// D1. deleteOne():
//     Moderator removes a single spam comment
db.comments.deleteOne({ _id: "CMT07" })
db.comments.countDocuments()

// D2. deleteMany():
//     Remove all remaining flagged (spam) comments
db.comments.deleteMany({ isFlagged: true })
db.comments.find({}, { _id: 1, text: 1, isFlagged: 1 })

// D3. deleteMany():
//     Remove inactive categories that have no articles
db.categories.deleteMany({ isActive: false })
db.categories.find({}, { _id: 1, name: 1, isActive: 1 })
