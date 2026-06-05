1. When adding a transaction for a party, the details on the page are not refreshing. I have to go back to the parties tab. And then click on the party again to view its details, than the new transaction are loaded. 
2. On Parties Tab > parties list, the party name if is big is summarized via a elipson. Instead in parties list in the party card, the name should have its own row, instead of shaing space with the active /inactive badge.


While adding transaction, In the Money source allocation section, only the first source input is enabled rest all are disabled.
I think the checkboxes whgere design to enable or disable this inputs, but by default only first is enabled and the rest sources even when checkboxes are toggled there status remain disabled.


party wise return

* On Parties Tab > parties list, the party risk information be in next row than the row showing status and phone number 

* On clicking calculate intrest of a party, a modal container shows up, but it shows xintgrest accured as Zero.


Now usually we collect interest from parties at the end of every month or can be on a custom date if party has submitted all remaining principle before the month end. So I want a provision in party details to calculate a Interest till custom date, by a date picker, defaults to current date. Alos create a seperate transaction records for intrest debit credit. So that we can create intrest record till a given date. And once part

________________

1. Remove the calculate Interest menu in the party menu, as it seems redundant. As we want a little more feature in calculating and managing interest.
2. Instead of a single Transaction history, create two types of transaction history. Principal Transaction history (is used to manage Transaction in Principle amount) and Interest transaction history (is used to track Interest transactions). Place Intrest transaction history card below the principle's card.

3. Remove the existing Fab button on parties tab. Instead Add text Button like used in collateral card named as "+ Add" in the resulting Principal Transaction History tab to add new Transaction.

4. For interest Transaction history, consider our requirement. We usually collect Intrest at the end of every month, however if party has paid Full principal. than we will calculate intrest on a different date. So I want a provision, that I can add entries in Interest Transaction history by two buttons. One is used to select a date picker, and it will calculate Intrest till the selected date. And create an entry in the interest Transaction history. For calculatging the next intrest, the starting date will be from the last calculated date till the date user selected for next enrty. The enetry such created, is the amount party has to pay so we can see how much monthly interest is pending for the party. Another button to create the entry for the Interest paid by the party. 

If this instruction is not clear ask me more questions before changes.


___________________

Ok there seems to be a bug. I have created a source with an initial amount of 10,00,000 rupees and than created a party named PartyA and lended him 100,000 ruppes of money created the principal transaction for it dated on 7 May 2026. Than gave another 200,000 on 15 May 2026. And than the party returns 50,000 rupees on 25 May 2026. Now I am trying to calculate intrest till 31 may 2026, it shows an error message that No intrest accured in the given period.



The intrest calculation seems to be coming incorrect. Till update 31 May the current logica calculate it as 1182.75. However the actual intrest is coming as 2775.

Here is how it is calculated.

100000 is given on 7 May 2026 which party uses till next transaction date  15 May 2026, that is for 8 days the principle amount partyu was using was 100000. So the interest is , 100000 * 1.5 * 8/3000   = 400 
1.5 is rate of interest
8 is the number of days
3000 is 30 * 100 , 30 days, and 100 is denominator of Rate of interest.

Next 200000 is given on 15 May 2026, so total amount now party is using since 15 may 2026 is 100000+200000= 300000, till next transaction which occurs on 25 May 2026, over for 10 days. So intrest is calculated as, 300000 * 1.5 *  10/3000    = 1500

Next 50000 party returns on 25 May 2025, so effective amount with user now is 250000, and as we have selectedc end date for calculation of intrest as 31 may 2026, than user used 250000 for 7 days (inclusive of 31st date) so the intrest is = 250000 * 1.5 * 7/3000 = 875

So the total interest is coming as 400+1500+875 = 2775

This is how bank calculate interest. Rate of interest is charged for per 30 days. 
And this how logic should have been. The entries of interest will be made as such:

Credit Debit Cummulative Date Days Interest

And once entries is created as such, the next intrest calculation will start from  the last interest calculated day.
_______________

When we calculate intrest, Interest transaction enrty should be made as such that on gui we can show it as such.

Interest charged from {last date oin which intrest calculated} - {current date till which intrest needs to be calculated} : {total interest}


This entry should also give details of calculations.
using a table with entries like :

| Credit | Debit | Total (Cummulative  of debit and Credit) | Date(of Tx)| Days | Interest

__________________


There is bug I found. I calculated intrest first till 31 May 2026.
Than I calculated intrest till 30 Jun 2026. In this calculation it seems to have included 31 May 2026 day from the previous calculation.
As the total of number of days in intrest calculation till 30 Jun 2026, its showing as 31 days. But June has only 30 days! and alos intrest of 1 days more was in the calculation.


_______________

Ability to Delete intrest returned entry in intrest transaction history.
As if an entry is done by mistake than it can be Deleted and than readded by user.

_______________


In the intrest Summary of a party.

1. The pending intrest is not comming correct.
2. Remove estimated interest feild, it seems to be of no use to me.
3. Add total income earned (sum of all interest returned by the user)
4. Based on this total income some stats can be show even on the home page for it.


On the home page:
1. On Home page The the Monthly Over view card, there are two buttons for selecting month and year, graph. But no change seems to be shown on the graph. The year graph should show how years state of given and returned.
2. Total income earned from interest from various party so far.


In Party's interest summary , the result for Pending interest feild is coming incorrect. Please check the logic. It should be same as Cummulative pending intrest as shown in the Intrest Transaction history, where it is calculated correctly.


__________

In the party's screen, there are some changes in collaterals.

1. Ability to add images.
2. Ability to edit collateral.
3. Ability to chnage its status from In possesion and returned if retruned back to user. Last updated date should be updated accordingly and show in the collateral list.


While updating or adding new collateral the notes section in it muts be text box

____________


Where can I see the source ledger ? 
Like if it has given some money to some party or some party has send money to the source than it must be shown its should automtically show those entries in that ledger for the source so the updated balacne can be seen for the source and verified.

In source tab , in the source list when I click the source, it should show me source ledger. Also in this ledger I should have ability to credit debit new records , for example the source maye have paid tax or bankl has charged intrest or we have cahs desposited in the account.



_____________

what I mean is In the sources tab in the source list. We see sourcer card for each source. In that Source card, instead of showing opening balance, show the Current balance.
And don't show the net lended amount in that source card.


______________

In the Parties tab, when we click on a party to see, party's details page, there is card which shows Source-wise Outstanding, instead o it Show Partner wise outstanding. As a party may be given money by Owner A from account1, but while receiving may get money in account2 of the same owner.


________

1. In the home tab, card fir Source Balance should display the sum of all current balance of all the sources. Its seems to be calculated statically rather than dynamically updating whenever the current balances of the sources change.
2. In the sources tab, I want an extra card which shows total balances partner wise.



______________


As we are using pouchdb I want a provision to optionally sync this data to background CouchDB installed on my home network.
Some form to edit this couch db details.
____________

Rename PWA to MunimJi and use an app icon as some accountant like logo.

_-------

Remove the Vector svg image you have added before the Dash summary on the home page.
The dash summary should be the first item on the Home tab






