
# Categories
* Needs a "suggested" view, like the merchants page has. Should show the pattern (editable), match type (editable) and category (editable). A Create and apply button will then create that category and apply it to all transactions.
* There needs to be a way to CRUD the actual categories

# Merchants
* suggested merchants view: "prefix" column should be named "pattern", and be editable. Table should contain two additional columns: "name" and "match type". "Use" link, should be a button called "Create". Expected use case - user makes minor adjustments to the pattern, chooses a name and a match type, then hits "Create" to save the merchant.
* Merchants page should a progress bar, just like the "Categories" page, showing progress on merchant normalization.

# Spending Reports
* Payment methods report should include Cash (like cash + fees from ATMs)
* Payment methods report - I want a separate bar for each credit card, and each credit
* I want a yearly summary report that defaults to the past 12 months and tells me: total amount spent, spending from each payment method, spending on each category (including uncategorized) and spending at each merchant (including uncategorized)

# Import Processing Pipeline

Get rid of payment method. It's not raw data, and it's not adding anything. Check numbers are all we need. 

User selects institution and uploads file [future - ability to add new institutions, rather than hard-code them]

Raw data is normalized using the correct importer. This includes setting the transaction type.

Database is scanned for duplicate data using the raw data hash. 

Duplicates are discarded from the import and put into a separate list so they can be shown to user later.

Merchant assignment - all transactions with a description that matches an existing merchant's rules are auto-assigned. The remaining transaction descriptions are de-deplicated, and internal transfers are excluded. Then they are sent to AI for processing, using the existing AI tool. AI can either infer that this is a new company that needs to be created, or infer that an appropriate company already exists, but needs its rules modified or added to. The user is blocked here until they approve or decline assignments either individually or in bulk.

Category assignment - each transaction that is matched to a company is then auto-assigned the default category for that company. 

Final list is presented to the user for approval / modification. 

User sees two tabs: New and Duplicates. Duplicate imports are shown next to the original from the DB, showing the timestamp when the original was imported. 

