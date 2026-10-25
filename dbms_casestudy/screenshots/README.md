# Screenshot naming guide

Rename each mongosh screenshot to the slot code below and drop it in this folder.
Any of .png, .jpg or .jpeg works. Rebuild with:

    python3 build.py ./screenshots out.docx

A capture too tall for one screen can be split: name the parts S17a.png and
S17b.png and both are placed under a single caption, scaled to a common width.

| Slot | Operation |
|---|---|
| S01.png | Creating the database and the five collections |
| S02.png | 5.1 insertOne() on categories |
| S03.png | 5.2 insertMany() on categories |
| S04.png | 5.3 insertMany() on authors |
| S05.png | 5.4 insertMany() on articles |
| S06.png | 5.5 insertMany() on readers |
| S07.png | 5.6 insertMany() on comments |
| S08.png | Verifying the inserted counts |
| S09.png | R1. Filter, projection and sort together |
| S10.png | R2. Comparison operators |
| S11.png | R3. Querying inside an array with $in |
| S12.png | R4. Sort with limit |
| S13.png | R5. Date range query |
| S14.png | R6. Querying embedded fields with dot notation |
| S15.png | R7. Array match with a boolean filter |
| S16.png | R8. Case-insensitive search with a regular expression |
| S17.png | R9. $or combined with array position |
| S18.png | R10. Counting matching documents |
| S19.png | R11. Aggregation with $lookup to resolve references |
| S20.png | R12. Aggregation with $group |
| S21.png | U1. updateOne() with $inc |
| S22.png | U2. updateMany() with $set |
| S23.png | U3. updateOne() with $set and $currentDate |
| S24.png | U4. updateOne() with $addToSet |
| S25.png | U5. updateOne() with $push into an embedded array |
| S26.png | U6. updateMany() on an embedded field |
| S27.png | D1. deleteOne() |
| S28.png | D2. deleteMany() |
| S29.png | D3. deleteMany() on categories |
| S30.png | Reading a stored document back in full |
