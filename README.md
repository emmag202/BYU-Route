App Summary
"This is a simple application for finding BYU Ryde stations and routes." BYU students and campus visitors often struggle with predicting shuttle arrivals, tracking peak-hour bus capacities, and quickly accessing their most frequently traveled shuttle lines. This problem leads to missed rides, excessive wait times, and unscheduled delays during peak campus commuting hours. The BYU Ryde app solves this by consolidating route map visualizations, scheduled stop departure countdowns, and real-time crowding metrics into a unified mobile interface. Users can search for specific stops or destinations, monitor live shuttle positions, compare alternative campus-bound routes, and save their most frequent lines for instant access. By standardizing route management and providing transparent occupancy data, the application optimizes student transit routines across Brigham Young University's campus network.

ERD


Tech Stack
Frontend (HTML5 / CSS3 / Vanilla JavaScript):

HTML5 & Vanilla JavaScript: Chosen for maximum performance, simple maintenance, and direct DOM manipulate without the overhead of heavy frontend frameworks.

CSS3 & Embedded SVG: Provides responsive, accessible styling with interactive vector graphics for precise map rendering, responsive bottom sheets, and route geometry visualization.

Backend & Database (Supabase):

Supabase: Offers instant RESTful API endpoints and real-time database capabilities, allowing seamless updates and persistent data storage.

How to Get It Running
Local Development
Clone the Repository:

Bash
git clone <repository-url>
cd <repository-folder>
Configure Supabase Credentials:

Create a Supabase project and execute the table schema (e.g., favorites table).

Open index.html (or your JS entry file) and initialize Supabase with your project URL and public anon key:

JavaScript
const SUPABASE_URL = "https://your-supabase-project.supabase.co";
const SUPABASE_KEY = "your-anon-key";
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
Launch the Application:

Open index.html directly in any web browser, or serve it using a local server extension (e.g., VS Code Live Server).

Hosted Platform
Access the Live App: Open the live deployment link: [https://your-app-name.vercel.app](https://your-app-name.vercel.app) (or your platform URL).

Access the Source Code: View the repository directly at [https://github.com/your-username/byu-ryde-app](https://github.com/your-username/byu-ryde-app).

Verifying the Vertical Slice
Follow these steps to test end-to-end functionality between the web UI and Supabase database using the "Add Favorite Route" feature:

Trigger the Action:

Launch the application and select any route from the home list (e.g., Route 11).

On the route detail sheet, click the "Add Favorite Route" button.

Verify that the UI displays a immediate visual confirmation (e.g., button state changes to "Saved to Favorites" or a confirmation badge appears).
Navigate back to Route 11 or check your top Favorites section.

Result: The route number is persistently saved in the Supabase favorites table and automatically rendered as favorited upon page reload.
