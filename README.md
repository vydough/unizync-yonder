# yonder

## Team Members
Vy Do, Anna Le, Cindy Thao, Metta Pangestu

## Description
This tool is a cross-university even discovery platform designed to make it easier for tertiary students to find university club events happening across different campuses 

University club events are currently fragmented across different university websites, union platforms, club pages, social media accounts and external ticketing services. 

Students often only discover events associated with their own university they already follow or are familiar with, which limits opportunities for cross-university participation, networking and social interaction.

## Use 
Instead of requiring users to manually search through large event directors which are overwhelming and cluttered, the platform uses a simple card-based interaction inspired by swipe applications. Relevant upcoming events are shown and students can: 
  - Swipe right to like/save an event.
  - Swipe left to pass an event.
  - View additional event information (price, location, club, description)
  - Review passed events they have previously saved.
  - Buy/Register tickets for events saved by accessing official provider page (EventBrite, Humanitix, UMSU. 

## Aim 
The aim is to reduce effort and friction required to find university events while helping students discover new clubs beyond their own campus. The platform is designed as a discovery layer rather than a replacement for current club and ticketing systems. Users are redirected to the original provider when registration or payment is required. 

## Installation
### Prerequisites
1. Make sure you have Python version 3.8 or greater installed
   
3. Download the tool's repository using the command:
    git clone https://github.com/vydough/unizync-yonder.git
   
4. Move to the tool's directory and install the tool
     cd ~/app/withackathon-unizync

     python3 -m http.server 8000

## Usage
  1. Log in with a university account or demo account.
  2. Select interests to generate a personalised event deck.
  3. Swipe right to save an event, swipe left to pass, or open the event for more details.
  4. View all available events in list view for easy navigation.
  5. View saved events from the Saved tab and manage preferences from Profile.
  6. Purchase event tickets / Register for free events with redirected URL to the provider's page.
  7. Become verified as a Club Organiser to be able to add club events and modify details.
  8. Modify weekly interests for upcoming events.
  9. Add friends from other universities.

## Additional Information
### Potential next steps for the tool
  - Add more universities and event providers/expand to more university union pages
  - Improve event parsing and deduplication for more providers
  - Expand notifications and organiser tools.
  - Deploy and test with real students.

### Limitations of the current implementation of the tool
  - Some event pages may not parse reliably.
  - Paid events may still redirect to external ticketing sites = still some friction
  - Recommendation quality depends on available event metadata.
  - Some features still require manual setup or administration e.g. Verification of club organiser
    
### Motivation for design/architecture decisions 
  - Supabase was chosen to provide database, authentication, realtime updates, and security in one backend.
  - universe.js separates backend logic from the frontend UI.
  - Recommendations are calculated centrally in PostgreSQL for consistency.
  - A rule-based scoring system was used to score the events based on user selection
  - Events are normalised into one format so multiple providers (Humanitix, EventBrite, UMSU) can be supported.
  - Swipe-based discovery was chosen to make finding events faster and more engaging/fun
