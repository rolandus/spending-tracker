# Import Pipeline
* The Merchants step in the import pipeline isn't editable and needs work, the number of matching things is wrong, etc..
* If you bail out on the merchant assignment step and then go to the merchants page, it says everything is already assigned. I guess it is because the imports didn't import, soo....
* User sees two tabs: New and Duplicates. Duplicate imports are shown next to the original from the DB, showing the timestamp when the original was imported. 

# Data Model
* Get rid of payment method. It's not raw data, and it's not adding anything. Check numbers are all we need. 
* Ability to add new institutions, rather than hard-code them
* What is the difference between Date and Posted Data? 
* Add & display "Date Entered"

# Categories
* Categories page can go away. Categories are bulk entered during import and tied closely to merchants
* Need the ability to CRUD categories

# Transaction List
* Abilitiy to easily edit things inline
* Turns out there is a notes filed in the DB, but no way to view it in the list. 
* The whole list needs cleaning up for better UX
* 

# Merchants
* suggested merchants view: "prefix" column should be named "pattern", and be editable. Table should contain two additional columns: "name" and "match type". "Use" link, should be a button called "Create". Expected use case - user makes minor adjustments to the pattern, chooses a name and a match type, then hits "Create" to save the merchant.
* Merchants page should a progress bar, just like the "Categories" page, showing progress on merchant normalization.

# Spending Reports
* Payment methods report should include Cash (like cash + fees from ATMs)
* Payment methods report - I want a separate bar for each credit card, and each credit
* I want a yearly summary report that defaults to the past 12 months and tells me: total amount spent, spending from each payment method, spending on each category (including uncategorized) and spending at each merchant (including uncategorized)



