# Import Pipeline
* The Merchants step in the import pipeline isn't editable and needs work, the number of matching things is wrong, etc..
* Mobile check deposits should be handled like transfers? I'm not sure on this one.
* If you bail out on the merchant assignment step and then go to the merchants page, it says everything is already assigned. I guess it is because the imports didn't import, soo....
* User sees two tabs: New and Duplicates. Duplicate imports are shown next to the original from the DB, showing the timestamp when the original was imported. 
* How to handle ATM withdrawls (cash)

# Data Model
* [IMPORTANT] - ability to do a data backup and restore from backup.
* Get rid of payment method. It's not raw data, and it's not adding anything. Check numbers are all we need. 
* Ability to add new institutions, rather than hard-code them
* What is the difference between Date and Posted Data? 
* Add & display "Date Entered"

# Categories

# Transaction List
* Abilitiy to easily edit things inline
* Turns out there is a notes filed in the DB, but no way to view it in the list. Also, it doesn't seem to save.
* The whole list needs cleaning up for better UX
* Ability to link a charge with a refund (like reimbursements for work, or Menards returns, etc...), so they don't show up as "spending"
* Ability to split transactions

# Merchants
* [IMPORTANT] Pending merchants need a "Merge with..." dropdown list where you indicate an existing merchant to tack the rules onto.
* [IMPORTANT] It looks like pending merchants are showing up both in the pending list and in the confirmed lsit.
* Merchants page should a progress bar, just like the "Categories" page, showing progress on merchant normalization.
* [IMPORTANT] Ability to link a default transction type AND category to each individual matching rule. 

# Spending Reports
* Payment methods report should include Cash (like cash + fees from ATMs)
* Payment methods report - I want a separate bar for each credit card, and each credit
* I want a yearly summary report that defaults to the past 12 months and tells me: total amount spent, spending from each payment method, spending on each category (including uncategorized) and spending at each merchant (including uncategorized)



