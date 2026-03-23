# Sreality.cz UX and Structure Analysis

Comprehensive analysis of the homepage and filter page to inform our UI implementation.

---

## 1. HOMEPAGE (sreality.cz)

### 1.1 Overall Page Layout

The homepage follows a **centered, single-column layout** with a search-first design philosophy. The visual hierarchy is:

1. Fixed top navigation bar (ribbon)
2. Centered hero section with logo + headline
3. Property type tabs (horizontal)
4. Quick action buttons (transaction type, location shortcuts)
5. Recommended listings grid

**Max container width**: ~1250px on large screens, with responsive breakpoints at 616px (tablet), 880px (desktop), and 1250px (large).

### 1.2 Navigation Bar (Ribbon)

- **Height**: 56px, fixed to top
- **Contents**:
  - Sreality.cz logo (left) linking to homepage
  - Search input with autocomplete (`szn-input-with-suggest-list` -- Seznam's custom component)
  - Personal menu / account section (right)
  - Seznam.cz parent branding
- **Style**: White background, subtle bottom border

### 1.3 Hero Section

Centered layout with generous vertical padding:

- **Sreality.cz logo**: Large, centered (215px on mobile, 320px on tablet+)
- **Main headline**: "Vyberte si z **100 175 nabidek** realit" (Choose from 100,175 real estate offers)
  - The listing count is **bold** within the sentence
  - Text color: Primary dark (#232B3A)
- **Subheading**: Muted description text (#626D82)

### 1.4 Property Type Tabs

A **horizontal scrollable tab bar** with the following tabs:

| Tab | Czech Label | English | Count Example |
|-----|-------------|---------|---------------|
| 1 | Byty | Flats/Apartments | 28,597 |
| 2 | Domy | Houses | 18,916 |
| 3 | Pozemky | Land | 27,411 |
| 4 | Komercni | Commercial | 19,602 |
| 5 | Ostatni | Other | 2,269 |
| 6 | Projekty | Projects (new developments) | 824 |

**UX patterns**:
- Each tab shows a **count badge** with the number of available listings
- Selected tab has **bold text** (font-weight 700), dark text color (#000F24), and an **underline indicator** (also #000F24)
- Unselected tabs are lighter weight with muted color
- Tabs are **horizontally scrollable** on mobile with gradient fade effects on edges
- Clicking a tab navigates to `/hledani/[type]` (e.g., `/hledani/byty`)
- Implemented as `<button>` elements inside a MUI Tabs component

### 1.5 Transaction Type and Quick Action Buttons

Below the tabs, a row of **pill-shaped buttons** with icons:

- **Prodej** (Sale) -- toggle/select button
- **Pronajem** (Rent) -- toggle/select button
- **V okoli** (Nearby) -- links to `/hledani`, location-based search
- **Zahranicni** (Foreign) -- links to `/hledani/zahranici`
- **Moje ulozene** (My saved) -- auth-gated, saved searches/favorites

These buttons function as **direct navigation links** rather than form inputs. Selecting "Prodej" + "Byty" navigates to `/hledani/prodej/byty`.

### 1.6 Location Search

Not prominently displayed on the homepage hero itself -- the location search is **in the navigation bar** as a persistent element. The filter page has the full location search.

### 1.7 Recommended Listings Section ("Doporucene")

**Section header**: "Doporucene pro Vas" (Recommended for you)

**Grid layout** (responsive):
- Mobile: 1 column (100% width)
- Tablet (616px+): 2 columns (50% each)
- Desktop (880px+): 3 columns (33.33% each)
- Large (1250px+): 4 columns (25% each)

**Number of cards**: Up to 12 listings (6 on mobile, 12 on desktop)

### 1.8 Property Listing Card Structure

Each listing card has a **vertical layout** with image on top and content below.

```
+---------------------------------------+
|  [Image - 4:3 aspect ratio]           |
|                                       |
|                          [Heart] (TR) |
|  [< ] (hover)          [>] (hover)   |
|                          [12 photos]  |
+---------------------------------------+
|  Prodej bytu 2+kk 58 m2              |
|  Ke Kapslove, Praha - Zizkov         |
|  11 690 000 Kc                       |
+---------------------------------------+
```

**Image section** (75% of card height):
- **Aspect ratio**: 4:3 (75% padding-top)
- **Lazy-loaded** with blur placeholder effect
- **Carousel**: Left/right arrows appear on hover, carousel dots for multiple photos
- **Photo count badge**: Bottom-right corner with camera icon + count
- **Favorite button**: Top-right corner, heart icon on gray background circle
  - Turns red (#CC0000) on hover/active

**Content section** (25% of card height):
- **Title**: Property type + disposition + area (e.g., "Prodej bytu 2+kk 58 m2")
  - Format: `[Transaction] [Type] [Layout] [Area] m2`
  - Optional suffix in parentheses: "(Podkrovni)" for attic apartments
- **Location**: Street name, City - District
- **Price**: Bold, large text (#232B3A, weight 700)
  - Sale format: `11 690 000 Kc` (spaces as thousand separators)
  - Rent format: `22 000 Kc/mesic` (per month)
  - Special: `Cena na vyzadani` (Price on request)

**Card interaction**:
- Entire card is a clickable link to the detail page
- Hover reveals carousel controls
- Separate click target for favorite button

### 1.9 Listing Data Fields from API

Each listing from the API contains:
- `name`: Title text (e.g., "Prodej bytu 2+kk 58 m2")
- `price` / `price_czk`: Price with `value_raw`, `unit`, `name`
- `locality`: Full address string
- `gps`: `{lat, lon}` coordinates
- `labels`: Array of feature tags (e.g., "Vytah", "Vybaveny", "Skola 1 min. pesky")
- `advert_images_count`: Number of photos
- `has_video`: Boolean
- `has_panorama`: Boolean (0/1)
- `has_floor_plan`: Boolean (0/1)
- `has_matterport_url`: Boolean
- `is_auction`: Boolean
- `attractive_offer`: Boolean (0/1)
- `new`: Boolean (new listing flag)
- `exclusively_at_rk`: Boolean (0/1, exclusive to one agency)
- `seo`: Contains `category_main_cb`, `category_sub_cb`, `category_type_cb`, `locality` slug
- `_links`: Image URLs and navigation links

**Labels examples** (shown as tags on cards):
- "Vytah" (Elevator)
- "Vybaveny" (Furnished)
- "Cihlova" (Brick building)
- "Parkovani" (Parking)
- "Castecne vybaveny" (Partially furnished)
- "Sklep" (Cellar)
- "Lodzie" (Loggia)
- "Skola 1 min. pesky" (School 1 min walk)
- "Obchod 6 min. pesky" (Shop 6 min walk)
- "Tramvaj 1 min. pesky" (Tram 1 min walk)
- "Sportoviste 8 min. pesky" (Sports facility 8 min walk)

### 1.10 Color Scheme

| Purpose | Color | Usage |
|---------|-------|-------|
| Primary text | #232B3A | Headings, prices |
| Secondary text | #626D82 | Descriptions, muted content |
| Primary accent/CTA | #CC0000 | Buttons, selected states, favorite hover |
| Accent hover | #AE0000 | Button hover state |
| Accent active | #8B0000 | Button pressed state |
| Borders | #E0E0E0 | Card borders, dividers |
| Light background | #F0F0F0 | Card backgrounds, input backgrounds |
| White | #FFFFFF | Page background, cards |
| Tab selected | #000F24 | Selected tab text + underline |
| Focus outline | #03A9F4 | Accessibility focus indicator (blue) |

### 1.11 Typography

- **Font family**: Inter, sans-serif
- **Base font weight**: 500
- **Headings**: 1.5rem (desktop), 1rem (mobile)
- **Labels**: 0.75rem, color #000D2480 (with alpha)
- **Input text**: 0.875rem

---

## 2. FILTER PAGE (sreality.cz/hledani/filtr/byty)

### 2.1 Page Layout

The filter page is a **full-page filter form**, not a sidebar layout. It is a dedicated page for setting search criteria before viewing results.

- **Max width**: 1100px container
- **Padding**: 36px horizontal on desktop, 16px on mobile
- **Top border radius**: 24px 24px 0 0 (card-like appearance)
- **Box shadow**: Elevated on tablet+
- **Title**: "Vyhledat nemovitost" (Find property)

### 2.2 Filter Sections (in order)

#### Section 1: Typ nemovitosti (Property Type)

**UI pattern**: Icon-based checkbox buttons, centered labels
**Selection**: Multiple selection allowed

| Value | Czech | English | API `category_main_cb` |
|-------|-------|---------|----------------------|
| 1 | Byty | Apartments | 1 |
| 2 | Domy | Houses | 2 |
| 3 | Pozemky | Land | 3 |
| 4 | Komercni | Commercial | 4 |
| 5 | Ostatni | Other | 5 |

- Additional link: "Prejit na developerske projekty" (Go to developer projects)
- **Selected state**: Red background (#CC0000) with white text
- **Unselected state**: Light gray background (#F8F8F8) with dark text

#### Section 2: Typ nabidky (Offer Type)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Value | Czech | English | API `category_type_cb` |
|-------|-------|---------|----------------------|
| 1 | Prodej | Sale | 1 |
| 2 | Pronajem | Rental | 2 |
| 3 | Drazby | Auctions | 3 |
| 4 | Podily | Shares | (shares) |

#### Section 3: Dispozice (Layout/Disposition)

**UI pattern**: Checkbox buttons in a grid
**Selection**: Multiple selection allowed
**Sub-label**: "Kategorie" (Category)

| Value | Label | API `category_sub_cb` |
|-------|-------|----------------------|
| 2 | 1+kk | 2 |
| 3 | 1+1 | 3 |
| 4 | 2+kk | 4 |
| 5 | 2+1 | 5 |
| 6 | 3+kk | 6 |
| 7 | 3+1 | 7 |
| 8 | 4+kk | 8 |
| 9 | 4+1 | 9 |
| 10 | 5+kk | 10 |
| 11 | 5+1 | 11 |
| 12 | 6 a vice (6 and more) | 12 |
| 16 | Atypicky (Atypical) | 16 |
| 47 | Pokoj (Room) | 47 |

**Note**: "kk" = kitchenette (kuchynsky kout), "+1" = separate kitchen room.

#### Section 4: Lokalita (Location)

**UI pattern**: Autocomplete text input with tag support
- **Placeholder**: "Zadejte adresu" (Enter address)
- **Component**: MUI Autocomplete with Seznam suggest list integration
- **Features**:
  - Multiple locations can be added as tags
  - Clear button to remove tags
  - "Hledat v okoli" (Search nearby) -- radius search option
  - Radius dropdown for distance
- **Input style**: Pill-shaped (border-radius: 100px), outlined variant

#### Section 5: Cena (Price)

**UI pattern**: Min/Max range inputs
- **URL parameters**: `cena-od` (price from), `cena-do` (price to)
- **Currency**: CZK (Kc)
- **Format**: Number inputs with space-separated thousands

#### Section 6: Plocha (Area/Size)

**UI pattern**: Min/Max range inputs
- **URL parameters**: `plocha-od` (area from), `plocha-do` (area to)
- **Unit**: m2 (square meters)

#### Section 7: Stav objektu (Building Condition)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Code | Czech | English | URL slug |
|------|-------|---------|----------|
| 1 | Velmi dobry | Very good | velmi-dobry-stav |
| 2 | Dobry | Good | dobry-stav |
| 3 | Spatny | Poor/Bad | spatny-stav |
| 4 | Ve vystavbe | Under construction | ve-vystavbe |
| 5 | Developerske projekty | Developer projects | projekt |
| 6 | Novostavba | New construction | novostavba |
| 7 | K demolici | For demolition | k-demolici |
| 8 | Pred rekonstrukci | Before reconstruction | pred-rekonstrukci |
| 9 | Po rekonstrukci | After reconstruction | po-rekonstrukci |

**API parameter**: `building_condition`

#### Section 8: Vlastnictvi (Ownership)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Code | Czech | English | URL slug |
|------|-------|---------|----------|
| 1 | Osobni | Personal/Private | osobni |
| 2 | Druzstevni | Cooperative | druzstevni |
| 3 | Statni/obecni | State/Municipal | statni |

**API parameter**: `ownership`

#### Section 9: Vybaveni (Furnishing/Equipment)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Code | Czech | English |
|------|-------|---------|
| 1 | Vybaveno / Ano | Furnished / Yes |
| 2 | Nevybaveno / Ne | Unfurnished / No |
| 3 | Castecne | Partially furnished |

**API parameter**: `furnished`

#### Section 10: Stavba (Building Type/Material)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Code | Czech | English |
|------|-------|---------|
| 1 | Panelova | Panel (prefab concrete) |
| 2 | Cihlova | Brick |
| 3 | Ostatni | Other |

**API parameter**: `building_type_search`

#### Section 11: Doplnkove vybaveni / Amenity Features (Group 1)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| API Key | Czech | English |
|---------|-------|---------|
| something_more1_200222 | Zahrada | Garden |
| something_more1_3090 | Balkon | Balcony |
| something_more1_3100 | Lodzie | Loggia |
| something_more1_3110 | Terasa | Terrace |

#### Section 12: Doplnkove vybaveni / Amenity Features (Group 2)

| API Key | Czech | English |
|---------|-------|---------|
| something_more2_3120 | Sklep | Cellar/Basement |
| something_more2_3130 | Bazén | Swimming pool |
| something_more2_3140 | Parkovaci stani | Parking space |
| something_more2_3150 | Garaz | Garage |

#### Section 13: Pristupnost / Accessibility Features (Group 3)

| API Key | Czech | English |
|---------|-------|---------|
| something_more3_1820 | Bezbariérový | Wheelchair accessible |
| something_more3_3310 | Vytah | Elevator/Lift |

#### Section 14: Energeticka trida (Energy Efficiency Rating)

**UI pattern**: Checkbox buttons
**Selection**: Multiple selection allowed

| Code | Label | Color (typical) |
|------|-------|-----------------|
| 1 | A | Dark green |
| 2 | B | Green |
| 3 | C | Light green |
| 4 | D | Yellow |
| 5 | E | Orange |
| 6 | F | Red-orange |
| 7 | G | Red |

**API parameter**: `energy_efficiency_rating_search`

### 2.3 Filter UI Component Patterns

**Checkbox button styling**:
- Unselected: Background `#F8F8F8`, dark text
- Selected: Background `#CC0000` (red), white text
- Hover (selected): Background `#AE0000` (darker red)
- Shape: Pill/rounded (border-radius: 100px)
- Transition: Color transitions on state change

**Range input fields**:
- Pill-shaped inputs (border-radius: 100px)
- Outlined variant with border color change on focus
- Label text above in muted color
- Side-by-side min/max inputs

**Autocomplete input**:
- Pill-shaped with clear button
- Support for multiple tag values
- Dropdown suggestion list on type

### 2.4 Search Submission

- **Primary action**: "Hledat" (Search) or "Zobrazit vysledky" button
- **AI search**: "Hledat s AI" (Search with AI) -- Beta feature with blue badge (#007AFF)
- **Button style**: Red (#CC0000), pill-shaped, full-width on mobile
- **Behavior**: Navigates to results page with URL parameters encoding all selected filters

### 2.5 Section Spacing

- Gap between filter sections: 24px (mobile), 40px (desktop)
- Internal padding: 16px (mobile), 36px (desktop)

---

## 3. SEARCH RESULTS PAGE (sreality.cz/hledani/prodej/byty)

### 3.1 Page Layout

**Desktop**: Two-column grid layout (`grid-template-columns: 2fr 1fr`)
- Left column (2fr): Listing results
- Right column (1fr): Map view

**Mobile**: Single column with map toggle button at bottom

### 3.2 Results Header

- **Page title/heading**: Dynamically generated from active filters
  - Example: "Prodej bytu 1+1, v osobnim vlastnictvi, stavba - panelova, velmi dobry stav Praha"
  - Format: `[Transaction] [Type] [Disposition], [Ownership], [Building type], [Condition] [Location]`
- **Results count**: Shown in heading area
- **Map toggle button**: "Zobrazit mapu" (Show map) / "Skryt mapu" (Hide map)

### 3.3 Sidebar Filters on Results Page

The results page has a **collapsible left sidebar** with the same filter groups as the filter page, allowing users to refine without going back:
- Property type checkboxes
- Offer type checkboxes
- Disposition checkboxes
- Location autocomplete
- Radius search: "Hledat v okoli" (Search nearby)

### 3.4 Listing Card (Results Page)

The results page cards appear similar to homepage cards but may have a **horizontal layout** on desktop (image left, content right) vs vertical on mobile.

### 3.5 Map Integration

- Map occupies the right 1/3 of the desktop layout
- Interactive map with property markers
- Map and list are synchronized -- scrolling through results may highlight map markers
- On mobile: toggled via "Zobrazit mapu" button, likely full-screen overlay

### 3.6 Sorting

Sorting is available but the exact options were not captured in the rendered HTML. Based on standard Sreality behavior:
- Nejnovejsi (Newest)
- Nejlevnejsi (Cheapest)
- Nejdrazsi (Most expensive)
- Nejmensi (Smallest)
- Nejvetsi (Largest)

### 3.7 Pagination

- **Results per page**: ~20 listings (standard)
- **URL parameter**: `page=N`
- Likely uses pagination buttons rather than infinite scroll

---

## 4. URL STRUCTURE AND ROUTING

### 4.1 URL Pattern

```
/hledani/[transaction]/[type]/[location]?[filters]
```

Examples:
- `/hledani/prodej/byty` -- Sale, apartments
- `/hledani/pronajem/byty/praha` -- Rent, apartments, Prague
- `/hledani/prodej/byty/praha?velikost=2+kk&stavba=panelova&vlastnictvi=osobni&stav=po-rekonstrukci`
- `/hledani/filtr/byty` -- Filter page for apartments

### 4.2 URL Query Parameters

| Parameter | Description | Example Values |
|-----------|-------------|----------------|
| velikost | Disposition size | 1+kk, 2+1, 3+kk |
| cena-od | Price from | 0, 1000000 |
| cena-do | Price to | 5000000, 10000000 |
| plocha-od | Area from (m2) | 0, 30 |
| plocha-do | Area to (m2) | 100, 200 |
| stav | Building condition | novostavba, po-rekonstrukci, velmi-dobry-stav |
| vlastnictvi | Ownership | osobni, druzstevni, statni |
| stavba | Building type | panelova, cihlova |
| vybaveni | Furnishing | vybaveno, nevybaveno, castecne |
| page | Page number | 1, 2, 3 |
| noredirect | Prevent redirect | 1 |

### 4.3 API Endpoints

**Base URL**: `https://www.sreality.cz/api/cs/v2/estates`

Key parameters:
- `category_main_cb`: Property type (1=apartments, 2=houses, 3=land, 4=commercial, 5=other)
- `category_type_cb`: Transaction (1=sale, 2=rent, 3=auction)
- `category_sub_cb`: Disposition (2=1+kk, 3=1+1, ... 12=6+, 16=atypical, 47=room)
- `per_page`: Results per page
- `page`: Page number
- `building_condition`: Condition codes (1-9)
- `ownership`: 1=personal, 2=cooperative, 3=state
- `furnished`: 1=yes, 2=no, 3=partially
- `building_type_search`: 1=panel, 2=brick, 3=other
- `energy_efficiency_rating_search`: 1-7 (A through G)

---

## 5. DESIGN SYSTEM SUMMARY

### 5.1 Component Library

Sreality uses **Material UI (MUI)** as the base component library with heavy customization:
- CSS-in-JS with Emotion (`.css-` prefixed generated class names)
- CSS custom properties for theming (`--color-*`, `--ribbon-*`)
- Container queries for responsive design
- Seznam's own components for search/suggest (`szn-input-with-suggest-list`)

### 5.2 Key UI Components

| Component | Pattern | Shape |
|-----------|---------|-------|
| Filter buttons | Checkbox-toggle pills | Pill (100px radius) |
| Text inputs | Outlined with label | Pill (100px radius) |
| Primary buttons | Solid red CTA | Pill (100px radius) |
| Property cards | Vertical image+content | Rounded corners |
| Tabs | Horizontal scroll with underline | Inline text |
| Autocomplete | Input with tag chips | Pill with tags |

### 5.3 Responsive Breakpoints

| Name | Min Width | Description |
|------|-----------|-------------|
| Mobile | 0px | Single column, stacked filters |
| Tablet | 768px | 2-column grid, side-by-side elements |
| Desktop | 960px | Full layout with sidebar/map |
| Large | 1250px | 4-column card grid |

### 5.4 Interaction Patterns

- **Filter selection**: Tap/click toggles checkbox state with immediate visual feedback
- **Search flow**: Select filters on filter page -> Submit -> View results with map
- **Card interaction**: Hover reveals carousel controls; click navigates to detail
- **Favorites**: Heart icon toggles saved state (auth required)
- **Location search**: Type-ahead autocomplete with multi-select tags
- **Map/list toggle**: Binary toggle on mobile, always visible on desktop

### 5.5 Animation and Transitions

- Button state transitions: 250ms
- Image carousel transitions: 400ms
- Lazy image blur-to-sharp effect on load
- Smooth tab indicator sliding
- Focus state transitions

### 5.6 Accessibility

- Blue focus outlines (#03A9F4) for keyboard navigation
- ARIA roles on table-like structures
- Semantic button elements for tabs
- Motion preferences support via CSS custom properties
- Screen reader labels on interactive elements

---

## 6. KEY TAKEAWAYS FOR IMPLEMENTATION

1. **Search-first homepage**: The homepage is dominated by the search interface, not content. The main action is selecting property type and transaction type, then browsing.

2. **Filter page is separate**: Unlike many real estate sites, Sreality has a dedicated full-page filter experience (`/hledani/filtr/byty`) separate from results.

3. **Pill-shaped everything**: Buttons, inputs, and filter toggles all use heavy border-radius (100px) for a modern, rounded aesthetic.

4. **Red as primary accent**: #CC0000 is used consistently for selected states, CTAs, and interactive highlights.

5. **Map + list split**: Desktop results use a 2:1 split layout with the map always visible on the right.

6. **URL-driven filters**: All filter state is encoded in the URL path and query parameters, making searches shareable and bookmarkable.

7. **API-backed**: The frontend consumes a REST API at `/api/cs/v2/estates` with well-defined parameter names for all filters.

8. **Card image priority**: Property cards give 75% of their height to the image carousel, emphasizing visual browsing.

9. **Czech-first with English support**: The site has an `/en/` path prefix for English, but Czech is the primary language.

10. **Progressive disclosure**: The homepage shows minimal filters (type + transaction), the filter page shows all options, and the results page shows inline refinement.
