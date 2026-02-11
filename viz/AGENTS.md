OpenCAMA
--------------------------------------
OpenCAMA is a browser-based, map-first CAMA, or Computer Aided Mass Appraisal system. Its intended user is local government mass appraisal property tax valuation offices.

This documentation is incomplete

# Overview
This is a browser based app built on top of MapLibre. Appraisers/assessors and GIS technicians will use this app to perform combined map review + basic valuation tasks. In its early stages it will be able to replace basic tools, but in the long run it will be capable of replacing the main CAMA suite.
# Modes
It can be run in two modes: “lite” mode and “pro” mode. 

## Lite Mode
In this mode, the application is simply a local-only browser app. There is no database connection and no cloud hosting. The user must upload data sources themselves. They can still export data and upload data, but nothing actually gets sent anywhere, it’s all processed locally. When working in this mode, it’s unfeasible to load jurisdictions on an order larger than n x 10,000 parcels.

## Pro Mode
This is everything Lite Mode has + extra stuff. In this mode, the application is a full-fledged professional CAMA system. It is backed by a real server, has full multi-user support, can handle real time edits and multi-user collaboration, robust version data versioning, and is powered by a database and PMTiles server that generates nightly tiles. Pro Mode is aspirational right now, we will build Lite mode out to the full extent of its capabilities, and then build out support for Pro Mode later.

# Technical
Locked decisions:


Language: HTML/CSS/TypeScript
Map Engine: MapLibre

# Metadata
The user can load in metadata, or construct it within the app. This metadata defines certain key pieces of information that the app needs to do its work.

**<filename>.opencama.json**
This is the name of an OpenCAMA project (metadata) file. It is in JSON format and it specifies the entire state of an OpenCAMA work session. Below are all the fields defined within it.

**data**
This section is a list of entries containing the information about files to load from disk. The filenames are relative to the location of the .opencama.json file itself.

**data.<entry>**
<entry> represents an individual entry in the list
data.<entry>.filename: the filename of the file to load
data.<entry>.fields: list of fields to load (only those specified will be loaded).
Alternatively, will accept the string “all” instead of a list
data.<entry>.data_dictionary: an optional data dictionary for this file

**fields.land_area**
This is the name of the field that represents the area of a parcel. It is paired with **units.land_area**, which must be one of: “sqft”, “acre”, “sqm”, “hectare”.

**fields.bldg_area**
This is the name of the field that represents the area of a building (presumably, finished square feet / total heated and cooled square feet). It is paired with **units.bldg_area**, which must be one of: “sqft”, “sqm”.

**filters**
This is a dictionary of entries containing named filters that the user has created.

**filters.<entry>**
<entry>  represents an individual entry in the dictionary
filters.<entry>.invert  reverses the logic of the whole filter
filters.<entry>.rules  the list of rules for this filter
filters.<entry>.rules.<rule>  represents an individual entry in the rules list
filters.<entry>.rules.<rule>.field  the field it operates on
filters.<entry>.rules.<rule>.fieldType  the type of field it is (numeric or categorical)
filters.<entry>.rules.<rule>.operator  the operator (one of “lt”,”gt”,”lte”,”gte”,”eq”,”neq”,”any”,”not-any”)
filters.<entry>.rules.<rule>.value  the value
filters.<entry>.rules.<rule>.active  whether the filter is on or off
## Data Dictionary
Data dictionaries can be provided for any data source. They are also JSON and their format is this:

{
"some_field":{
		"name": "Field’s name",
		"description": "Description of Field",
		"type": "string"
	},
	...
}

Basically, you have a list of keyed entries. The keys are the field names, and the entries contain the following fields:

name: the display name of the field
description: a longer description that will show up on tooltips and stuff in the UI where we have room
type: one of [“string”, “number”, “percent”, “boolean”]
groups: array containing one or more strings. Optional.
step_size: how big the step size for numeric steppers should be. Optional.


# Startup wizard

The “blurb” mentioned below:
Please identify certain key fields. The most important ones are marked in BOLD.

Then mark these as bold:
Building/Improvement: Size, Size Unit
Land: Size, Size Unit
Sale: Price, Date, Valid, Vacant

+-----------------------------------------------+
| Identity key fields:                          |
| ~blurb~                                       |
|                                               |
| Parcel ID[  ▼] Address    [  ▼]               |
|                                               |
| Building/Improvement                          |
| Size:    [  ▼] Size unit: [  ▼]               |
| Quality: [  ▼] Condition: [  ▼]               |
| Age:     [  ▼] Eff. Age:  [  ▼]               |                                            
| Beds:    [  ▼] Baths:     [  ▼]               |
| Type:    [  ▼]                                |
|                                               |
| Land                                          |
| Size:    [  ▼] Size unit: [  ▼]               |
| Type:    [  ▼] Zoning:    [  ▼]               |
|                                               |
| Sale                                          |
| Sale ID  [  ▼]                                |
| Price:   [  ▼] Date:      [  ▼]               |
| Valid:   [  ▼] Vacant:    [  ▼]               |
|                                               |
|                                               |
+-----------------------------------------------+

# Interface
The basic interface looks like this: toolbar on the left, map on the right (ascii):

+----+----------------------------------+
| A  |                                  |
|    |                                  |
+----+                                  |
| B  |                                  |
|    |                                  |
+----+                                  |
| C  |             MAP                  |
|    |                                  |
+----+                                  |
| D  |                                  |
|    |                                  |
+----+                                  |
| E  |                                  |
|    |                                  |
+----+----------------------------------+

…where A, B, C, D, E are various tools

The map is a standard MapLibre map, which by default just shows a basemap and nothing else. The tools are buttons you click on to do stuff. The main thing they do is to spawn menus.

## Toolbar
The toolbar consists of tools and menus:

Here are all the tools:

Pan
Select
Inspect

Here are all the menus:

Layers
Legend
Paint
Statistics
Filters
Scatter Plot
Land Schedule
Settings

### Common Toolbar Button Behavior
All buttons have an SVG icon. They come in various flavors:

Menu button
Tool button

A menu button will function as an on/off toggle for that menu. Clicking it will show/hide the corresponding menu. Menu buttons are independent of other buttons

A tool button activates the current tool and deactivates all other tools. Only one tool can be active at a time. The currently selected tool will be displayed with a highlight outline.

Any button can have a hotkey assigned to it in the code. If a hotkey is assigned to it, pressing the hotkey will have the same effect as clicking on the button. The hotkey is displayed in the upper left corner of the button as a text field.

Some tool buttons can have sub-tools attached to them. If a button has sub-tools defined, then the button will display a ◢ in its lower-right corner. Like this (ascii):

+---+
|   |
|   |
|  ◢|
+---+

Long-clicking on a button with sub-tools will cause the sub menu to open and allow you to choose one of the other sub-tools. Selecting a sub tool from the sub-menu will change the icon of the mother tool button to that of the currently selected sub tool.

Now for all of the tools:
## Tools

### Pan

### Select

### Inspect

## Menus
### Common Menu Behavior
Basic menus look like this (ascii):
+------------------------------------------+
| Menu Name                              ▼ |
+------------------------------------------+
|                                          |
|                                          |
|                                          |
|                                          |
|                                          |
|                                          |
+------------------------------------------+

The top bar is draggable, and the ▼ button will close/hide the menu.

Menus may not escape the bounds of the map layer. Menus may have certain optional controls added to them. Like this (ascii):


+------------------------------------------+
| Menu Name                            📌▼ |
+------------------------------------------+
|                                          |
|                                          |
|                                          |
|                                          |
|                                          |
|                                        ◢ |
+------------------------------------------+

The ◢ represents the visual affordance of an expandable window. Clicking and dragging this element will expand the window. It doesn’t actually look like a black arrow, it looks like that little textured “three lines” or whatever element that is used in draggable window chrome in OS windows.

The 📌 means “pin” and will put the window into “pinned” mode. When the window is in “pinned” mode it will no longer be free-floating but will be visually anchored directly into the sidebar chrome. Like this (ascii):

+----+----------+---------------------------------+
| A  |Menu   📌▼|                                 |
|    +----------+                                 |
+----+          |                                 |
| B  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| C  |          |            MAP                  |
|    |          |                                 |
+----+          |                                 |
| D  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| E  |          |                                 |
|    |          |                                 |
+----+----------+---------------------------------+

Multiple windows can be pinned in this way, like this (ascii):

+----+----------+----------+---------------------------------+
| A  |Menu1  📌▼|Menu2  📌▼|                                 |
|    +----------+----------+                                 |
+----+          |          |                                 |
| B  |          |          |                                 |
|    |          |          |                                 |
+----+          |          |                                 |
| C  |          |          |            MAP                  |
|    |          |          |                                 |
+----+          |          |                                 |
| D  |          |          |                                 |
|    |          |          |                                 |
+----+          |          |                                 |
| E  |          |          |                                 |
|    |          |          |                                 |
+----+----------+----------+---------------------------------+

Pinned menus are an inherent part of the chrome to the right of the toolbar, that is, they do not *overlap* the MapLibre map canvas, they *push it further to the right*.

The pin icon will change visual state when the menu is in pinned mode. Clicking the pin on a pinned menu will unpin it and return it to free floating status.

Although it is not indicated in this mockup, the thumbtack icon has two states: tilted and untitled (use thumbtack.svg and thumbtack-tilted.svg). When a menu is pinned, use the untitled icon, and when it is unpinned use the tilted icon.

A pinned menu can still be expanded by clicking either on the drag element in the lower right hand corner, like this (ascii):
+----+----------+---------------------------------+
| A  |Menu   📌▼|                                 |
|    +----------+                                 |
+----+          |                                 |
| B  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| C  |          |            MAP                  |
|    |          |                                 |
+----+          |                                 |
| D  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| E  |          |                                 |
|    |         ◢|                                 |
+----+----------+---------------------------------+

Or else by dragging the right edge border of the menu itself. In either case, this will resize the horizontal width of the PINNED version of the menu. The cursor will update to a ↔ to indicate this possibility.

If a menu does not take up the full height, when it is pinned there will just be empty chrome beneath it. In this latter case, the right hand corner can be dragged both horizontally and vertically.

+----+----------+---------------------------------+
| A  |Menu   📌▼|                                 |
|    +----------+                                 |
+----+          |                                 |
| B  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| C  |         ◢|             MAP                 |
|    +----------+                                 |
+----+          |                                 |
| D  |          |                                 |
|    | (empty)  |                                 |
+----+          |                                 |
| E  |          |                                 |
|    |          |                                 |
+----+----------+---------------------------------+

If another menu’s title bar (either floating menu, or pinned menu) is dragged into a pinned frame, the menu will pin itself into the destination panel if there is room


Before:


                 Drag this
                     |
                     |
                     V
+----+----------+----------+---------------------------------+
| A  |Menu1  📌▼|Menu2  📌▼|                                 |
|    +----------+----------+                                 |
+----+          |          |                                 |
| B  |          |          |                                 |
|    |          |          |                                 |
+----+          |          |                                 |
| C  |          |          |            MAP                  |
|    |          |          |                                 |
+----+          |          |                                 |
| D  |          |          |                                 |
|    |          |          |                                 |
+----+          |          |                                 |
| E  |          |          |                                 |
|    |          |          |                                 |
+----+----------+----------+---------------------------------+
          ^
          |
          |
       Drop here

After:

+----+----------+---------------------------------+
| A  |Menu   📌▼|                                 |
|    +----------+                                 |
+----+          |                                 |
| B  |          |                                 |
|    |          |                                 |
+----+          |                                 |
| C  |         ◢|             MAP                 |
|    +----------+                                 |
+----+Menu   📌▼|                                 |
| D  +----------+                                 |
|    |          |                                 |
+----+          |                                 |
| E  |          |                                 |
|    |          |                                 |
+----+----------+---------------------------------+
        

### Common Menu Elements

**Per area denominator radio buttons**

This pattern (ascii):

<some field, dropdown/display/etc>
 ○ as-is                             
 ○ ...per land size square feet (ft²)
 ○ ...per bldg size square feet (ft²)

This pattern changes how a numerical field is interpreted by giving the user a choice of denominators. The choices are 1.0/no denominator (as-is), divide by the land area, and divide by the building area. The land/building area fields are determined by the metadata. If there is no such field in the relevant data source/layer, incompatible elements will be hidden. If the only viable choice is “as-is”, then no radio buttons will be displayed at all.


**Data source & subject selector**

This pattern (ascii):

  Layer: some_field (some_file.parquet)
Subject: [ All ] [ Visible ] [ Selected ]

This UI pattern allows the user, given a specific data source/layer, to define a **subject** within it. Such as, “in the parcel universe, everything where land_use = ‘single_family’”, or “in the sales layer, all the selected parcels.”

The subject buttons are linked toggles, only one can be active at a time and the current one is highlighted. 
All: subject is all parcels
Visible: subject is all parcels flagged as visible in the specified layer
Selected: subject is all parcels part of the current selection
This button is greyed out if the subject layer is not currently selected in the layers menu


**Collapsible Sections**

Use CSS rotation for collapse toggle arrows, not dynamic text content. This provides smooth transitions and consistent behavior across the app.

HTML structure:
- Button with class `land-schedule-collapse-toggle`
- Content text: `▼` (always down arrow in the HTML)
- Initial state: add `is-collapsed` class if starting collapsed
- Body element: use `is-hidden` class when collapsed, or toggle `display: none/grid` via JavaScript

CSS (already defined in index.html):
```css
.land-schedule-collapse-toggle.is-collapsed {
  transform: rotate(-90deg);
  transition: transform 0.2s ease;
}
```

JavaScript pattern (in main.ts):
```typescript
const setMyCollapsibleCollapsed = (collapsed: boolean) => {
  S.isMyCollapsibleCollapsed = collapsed;
  myBody.style.display = collapsed ? 'none' : 'grid';
  myToggle.classList.toggle('is-collapsed', collapsed);
  myToggle.title = collapsed ? 'Expand Section' : 'Collapse Section';
  refreshWindowMinHeight(myPanel);
};
```

Do NOT use dynamic `textContent` switching between `▶` and `▼`. The CSS transform handles the visual rotation.


### Layers
This is a list of layers, like in QGIS or Photoshop. It looks like this (ascii):

+-----------------------------------+
| Layers                           ▼| <-- Header
+-----------------------------------+
|                                   | <-- Layers section
| [ Add layer ]                     |
| ● 👁 ▽ [neighborhood ]📊░ ▲▼ X    |
| ○ 👁 ▽ [sale price   ]📊░ ▲▼ X    |
| ○ 👁 ▽ [bldg sqft    ]📊░ ▲▼ X    |
| ○ 👁   [satellite    ]⬜🌐        |
| Current layer                     |
| source: something.parquet         |
| —-------------------------------- |
| Field to visualize                | <-- Visualize section
| [neighborhood     ▼]              |
+-----------------------------------+

This individual element is a “layer entry”:

● 👁 ▽ [neighborhood ]📊░ ▲▼ X

It consists of an eye button, a radio button, a name field, a pair of up/down buttons, and an x button. To the right there are three buttons: ▽📊░. ▽ represents filters.svg, which is grayed out by default. 📊 represents chart.svg, and ░ represents scatter.svg. The latter two, 📊░, are fully visible and solid.

The eye button shows and hides the layer on the map. 
The radio button selects one and only one layer as the currently active layer. Other operations that care about the “current layer” that do not have more specific context will rely on this. 
The up/down arrows move the layer entry within its list
The x button removes that layer (with confirmatory pop-up).
The ▽ (filter) button opens the filters menu and allows the user to apply filters to the current layer
When a layer has filters applied, a solid filter icon will be displayed next to it
When a layer has no filters applied, a grayed out filter icon will be displayed next to it
The 📊 button opens the statistics menu, selecting the associated layer as the focused layer.
The ░ button opens the scatterplot menu, selecting the associated layer as the focused layer.

The add layer button prompts the user to add a new layer in a modal popup. They can pick from any previously uploaded data sources, or browse for a new file, or cancel.

The visualize field picks the field that drives the styling of the layer. Actual styling is driven by the “Paint” menu.

There is a special layer entry that always appears at the bottom of the stack:

○ 👁  [satellite    ]⬜🌐

This governs the basemap.

It has two toggle buttons to its right – only one can be highlighted at a time. 
The ⬜ represents streets.svg and toggles the OSM basemap.
The 🌐 represents globe.svg and toggles the satellite basemap.
Clicking the 👁 will show/hide the basemap layer itself

There is a subsection called “Paint”:

This has two modes, depending on the type of the field. 

Numeric:

+-----------------------------------+
| Paint                            ▼| <-- Header
+-----------------------------------+
|                                   |
| Field type: numeric               |
| Color method                      |
| ● Random color                    |
| ○ Single color                    |
| ○ Color ramp                      |
|                                   |
| —-------------------------------- |
| Opacity                           | <-- Opacity slider
| ===================[]------------ | 
+-----------------------------------+

Random color assigns a random color to every parcel
Single color will spawn a simple widget button that displays the current color, clicking that will bring up a color picker. That color will be applied to every parcel
Color ramp will spawn a dropdown that will let the user pick one of several predefined color ramps

Categorical:

+-------------------------------------+
| Paint                              ▼| <-- Header
+-------------------------------------+
|                                     |
| Field type: numeric                 |
| ○ as-is                             |
| ○ ...per land size square feet (ft²)|
| ○ ...per bldg size square feet (ft²)|
|                                     |
| []3D enabled                        |
|                                     |
| Color ramp                          |
| [ Viridis ] 
|                                     |
| —---------------------------------- |
| Opacity                             | <-- Opacity slider
| ===================[]-------------- | 
+-------------------------------------+

The basemap layer entry may be selected as well, and it has special visualization rules that appear under “Paint” if it is selected:

The field type should read: “basemap”
There is no color method option
There is an opacity slider, so you can control the opacity of the basemap


### Filters

A filter is a list of one or more conditions. When taken together as a list, the conditions are considered to all be joined by Boolean AND.

A condition contains:
A field 
An operator
A value

Numeric operators: >, <, >=, <=, =, !=
Categorical operators: =, !=, is any, not any
Special operator: “filter” (pick this and the value is just a named filter from your list of saved filters)

Additionally, there is a special condition which is just a reference to a named filter. In this case the condition resolves to the contents of that filter. This is to make it easier to compose complex filters. 

The filter interface allows you to build filters out of individual conditions, as well as other filters.


### Statistics

### Scatter Plot

### Time Adjustment

The time adjustment menu is a tool that allows the user to visually generate TAFs, or Time Adjustment Factors. It has a button in the toolbar, and opens up a standard menu that works like all the other menus. Its icon is clock.svg.


```
+------------------------------------------+
| Time Adjustment                         ▼|
+------------------------------------------+
| ▼ Settings                               |
| Sale price field (i): [ sale price  ▼ ]  |                                      
|                                          |
| Improved filter (i):  [ ▽ conditions ]   |
| Improved size (i):    [ bldg sqft   ▼ ]  |
|                                          |
| Vacant filter (i):    [ ▽ conditions ]   |
| Land size (i):        [ land sqft   ▼ ]  |
|                                          |
|                                          |
+------------------------------------------+

The time adjustment entries menu starts off looking just like this. It is collapsible and has a text entry field with a [ + ] button next to it. Clicking the [ + ] button will create a new time adjustment entry.

| —--------------------------------------- |
| ▼ Time adjustment entries                |
| [ enter name ] [ + ]                     |
|                                          |

When at least one time adjustment entry has been defined, the interface will look like this:

| —--------------------------------------- |
| ▼ Time Factor schedules                  |
| [ enter name ] [ + ]                     |
| [ select time adjustment ▼ ]             |

Selecting a time adjustment entry from the dropdown will look like this:


| —----------------------------------------|
| ▼ Time Adjustments                       | <--collapsible
| [ enter name ] [ + ]                     | <--[+] add named entry
| [ abc adjustment ▼ ]                     | <--select entry
|                                          |
|  Name: abc adjustment            [❌]    | <--[x] delete entry
|  Start:          [2026-01-01 ▼ ]         | <--calendar picker
|  Valuation date: [2026-12-31 ▼ ]         | <--calendar picker

The user must pick a start and valuation (end) date for the time adjustment for the rest of the time adjustment entry to populate. They can also delete the time adjustment by clicking on the x, which will prompt before they delete it. The end result of this will be a series of multipliers for defined time periods between the dates, which can convert a sale price at that time to one more reflective of the market on the valuation date. IE, the multiplier for the valuation date should always be 1.0, and everything else normalized against that.

Once start and end dates have been picked, the rest of the time adjustment will populate:

|  Include: [ ▽ conditions ]               | <--filters
|  Exclude: [ ▽ conditions ]               | <--filters
|  Sales in sample: 53                     |
|------------------------------------------|
|  ▼ Calculation                           |
|  Display:     [ improved ▼ ]             | <--vacant/improved picker
|  Group by:    [ category ▼ ]             | <--group/color on charts
|  Granularity: [ Monthly ▼ ]              |<--monthly/peak/annual
|  Method:      [ Median ▼ ]               |<--median/avg
|  Min sample:  [ num +- ]                 |<--min sample stepper
|  Exclude outliers outside:               |<--outlier exclusion
|  Price: low [    ]   high [     ]        |<--num steppers
|  Size:  low [    ]   high [     ]        |
|                                          |
|  ▼ Data                                  |
|  [ Plot trend ]                          | <--plot trend btn
|  |            *        *                 | <--data points
|  |              *      *                 |
|  |    *   * * * **     *                 |
|  |      * *     *  * * * *               |
|  |    * * * * *  * * * * *     *         |
|  |  *   * * *      * *   * * *   *       |
|  |  * *   * *    *         * * * *       |
|  |  *                      * * * *       |
|  +----------------------------------     |

The user can optionally choose to attach inclusion & exclusion filters. Updating these will update the list of selected sales in real time. Selected sales must be selected by the inclusion filters, NOT selected by the exclusion filter, and be within the specified date range (inclusive on both ends).

Below the horizontal line divider is the time adjustment calculation subsection. The user must select whether to display improved or vacant sales. The user can optionally group by any categorical field. There is a default value of (None) which will not apply a grouping and just do the whole selection.

The user can specify outlier exclusion ranges. These sales will be excluded from the final calculation, but they will still be displayed on the chart, just as open circles instead of solid dots and marked as excluded due to being outliers in the hover text.

The Data subsection shows a graph, which charts all the individual sales selected by both the time entry and the vacant/improved mode. The user selects the granularity, which determines the time resolution/time grouping. Raw sales data points are updated on the chart in real time. Sale prices are interpreted as their normalized value according to the time adjustment settings (improved sale price / improved square footage, vacant sale price / land square footage, etc). The y axis is sale price and the x axis is time. The range of the x axis is the specified time interval of the time adjustment, and the tick spacing is the user’s chosen time granularity. In this way for each time granularity, we get a stack of sale price data points clustered vertically on that time point.

The options for granularity are "year", "peak", "quarter", and "month". These define the groupings. For year, quarter, and month, the dates are simply converted to ISO standard time, and then we just get the year, quarter, or month number and assign that as the grouping. For each group of sales (ex: "all sales in January 2025" or "all sales in Q2 2024"), a minimum sample check is applied based on the user’s settings from the minimum sample button. If there is not enough sample, sales from that time period are ignored in the time adjustment calculation. These sales will be shown on the chart as x icons rather than as dots. Hovering the dots will show their values and their exclusion status due to sample size.

Peak has slightly special behavior – under the hood it will be implemented as monthly sampling, but the algorithm will attempt to find three data points, two of which are fixed and one of which is floating. The two fixed points are start and end of year. The floating data point is the data point with the highest peak central tendency (more on this later).

When the user clicks "plot trend", the graph will update to look like this:
 
|                                          |
|  ▼ Trend                                 |
|  [ Plot trend ]                          |
|  |            ·         ·                |
|  |              ·       ·                |
|  |    ·   · · *-* ·     *                |
|  |      · ·  /  ·\  · ·/·\·              |
|  |    *-*-*-* ·   *-*-* · *     ·        |
|  |  ·/  · · ·       · ·   ·\· ·   ·      |
|  |  * ·   · ·     ·         *-*-*-*      |
|  | /·                       · · · ·\     |
|  +----------------------------------     |
|                                          |
|  Export: [📄][📊]                        |


Solid dots will become tiny (but still solid), and the trend will be calculated in the following way depending on chosen method:

Median: take the median value of each group
Mean: take the mean value of each group
Regression:
- Independent variable: log(normalized sale price)
- Dependent variables: time group dummies
- Interpretation: take time period group dummy coefficients, exponentiate them to get percentages.

After we have our base values, assign them back to their original time period groups in order, and ensure that the first time period group is normalized to 1.0, so that all subsequent time period groups get a time factor that is a straight multiplier.

Chart the resulting multipliers as an overlay that is scaled to the size of the original predictions, and put a second Y axis on the right hand side which shows the % multipliers, and ensure those values are accurate. 

The user clicks plot trend to show/hide.

The trend is recalculated whenever any of its inputs are changed. We want to watch out for unnecessary work, so anytime its time to refresh the plot, we will do a few things:
Cue a spinner, and wait a few seconds before doing anything.
If more changes come in before the timer’s up, reset the timer
When the timer runs out, do the actual calculation
If it seems the calculation will be expensive, do it asynchronously or with a web worker or something. Make sure to error out gracefully or timeout if it takes way too long, and display the error message on the graph.

As for this line:

|  Export: [📄][📊]                        |

The [📄] button is “export CSV”
The [📊] button is “export Excel” 

When the user clicks either button, the following dataframes will be generated and packaged together in either a zip file (CSV export) or as separate sheets in an excel file (Excel export):
Main time adjustment:
Headers:
“Factor” (the multiplier) is a number normalized to 1.0 on the valuation date
“Year”, “Month”, or “Quarter” depending on user selection
Year is always formatted YYYY, e.g. 2025
Month is always formatted YYYY-MM, e.g. 2025-01
Quarter is always formatted YYYY-QQ, e.g. 2025-Q3
If the user selected “Peak” then “Month” is used as the time period label. The first and last month will always be January/December of that year, and the middle month will be whatever month it picked as the peak
Daily time adjustment:
Headers: 
“Factor”, same as above
“Day”
Formatted as YYYY-MM-DD
The daily time adjustment is generated from the main time adjustment by linearly interpolating the time factor between data points on a per-day basis. This way it has accurate coverage of the entire calendar year and there’s no chunky jumps from period to period.

If CSV export, the time adjustment filename will be:
<name of time adjustment entry>_time_adjustment.csv.zip
And will contain:
- <name of time adjustment entry>_time_adjustment.csv
- <name of time adjustment entry>_time_adjustment_daily.csv

If Excel export, the time adjustment filename will be:
<name of time adjustment entry>_time_adjustment.xlsx
And will contain these named sheets:
- “by <time period group>”
- “by day”

Then the file will be downloaded to the user’s computer.

### Land Schedule

A land schedule is a series of tables and adjustments that govern land value.

First, the user must assign land schedules to different locations/categories:

```
+-------------------------------------+
| Land Schedule                       |
+-------------------------------------+
| Model group:                        |
| [ single_family ▼ ]                 |
|                                     |
| Market area field:                  |
| [ neighborhood ▼ ]                   |
|                                     |
| value:                              |
| [ River Heights ▼ ]                  |
|                           [ apply ] |
| —-----------------------------------|
```

First, the user selects a model group. Then, they select a market area field. Each land schedule belongs to a particular model group + market area condition.

Here the user has chosen “neighborhood” as the market area field that governs land schedules, and has selected “River Heights” as their current land schedule. The interface starts off blank but they can add new things to it, which will generate a land schedule entry under “neighborhood = River Heights”

The value selector allows the user to pick any unique value within their chosen market area field, but additionally there is a special value called “default schedule” which is always available, and is the first choice in the dropdown. This will be a globally applicable land schedule.
The “apply” button causes the linked land value surface to be recalculated, if there is one, and repainted accordingly.

When empty the land size tables section looks like this: just has a single button to add a new table

|-------------------------------------|
| Size tables                         |
|                                     |
| [ add table ]                       |
|-------------------------------------|

A land table, when first created, looks like this:
Name: [ blah ]                  [x] <--delete table button
Unit: [ sqft   ▼ ] <--name, filter, unit selector
+--------+---------+--------------+
|Min     |Max      | Value        | <--table headers
+--------+---------+----------+---+
|-       | -       | $-       |[x]| <--table row values, del row btn
+--------+---------+----------+---+
                        [ add row ] <--add row button

The [ name ] field lets you apply a name to this land schedule.
The ▽ represents the filter icon and allows you to apply conditional logic to this land schedule’s scope.
Clicking this will open up the filters menu, but instead of the current scope being a layer, the current scope of the filter will be this table itself. This table will only apply to the rows selected by the boolean union of the categorical selector up top plus this filter.
These filters are saved in the data model as attached to this land schedule
The unit selector lets you pick a unit type: area, frontage, or base lot. If imperial, choices are: area (sqft), area (acre), frontage (ft). If metric, choices are: area (sqm), area (hectare), frontage (m).
Values of “-” in the ascii represent empty fields. These are “null” values that are interpreted as:
Min: 0
Max: No maximum, infinity
Value: 0
The “Value” header will update to read Value / <unit> depending on the selected unit.
Clicking [ add row ] will add a new row to the table
Clicking [ x ] on any row will delete that row from the table
Enforce size constraints: 
the Min value of each subsequent row automatically matches the Max value given just above it
the Max value of each row must be equal to or greater than its Min value
Clicking the delete table [ x ] (with “are you sure?” prompt) will delete the table from the schedule.

Once there is at least one table, there is a dropdown menu in the land table section:

|-------------------------------------|
| Size tables                         |
|                                     |
| Current table: [ ▼ something ]     |
| [ add table ]                       |
|-------------------------------------|

The user can select any created table from the menu. Only one table is shown at once, and selecting from the menu will determine which table it is. 

Below the current table is a collapsible section named “Curve”:


▼ Curve
$
/ |*---*
s |     *--*
q |         *--*
f |             \                  
t +--------------------------------
                sqft               

This is a plotly.js points-and-lines graph that corresponds 1:1 with the current land table. It updates in real time with the table. The y-axis is the money value per size unit, and the x axis is the amount of the size unit. This graph is not interactive – you can’t click on anything, but it updates whenever you update your schedule. Hovering over a data point will show the X/Y values of that point.

Below the tables, there is a collapsible section for ADJUSTMENTS. 

It starts off like this:

| ▼ Adjustments                       |
| +---------------------------------+ |
| |                 [add adjustment]| |
| +---------------------------------+ |

The user can add adjustments with the add adjustment button

| ▼ Adjustments                       |
| +---------------------------------+ |
| | Name: [ blah ]               [x]| |
| | Conditions: ▽                   | |
| | Operation: [ something ▼ ]      | |
| | Size unit:    [ sqft ▼ ]        | |
| | Value: [ num ]                  | |
| +---------------------------------+ |
| |                 [add adjustment]| |
| +---------------------------------+ |


The user can delete adjustments with the [x] button per adjustment entry
Each adjustment entry has a "Conditions" button with a filter icon and "Modification" entry which is a dropdown
Conditions button: opens the filter interface. These filters are attached to this adjustment.
Operation button: choices are:
Multiply: this value gets multiplied by the table-derived value
Add: this value gets added to the table-derived value
Size unit dropdown: choices are:
Per area (sqft/acre or sqm/hectare)
Frontage (feet or meters)
Flat amount (no unit)
Value: put a number here. If the modification is multiply, then this is styled specifically as an unbounded numeric picker centered on 1.00, with an “x” following it. Otherwise it’s a normal numeric value picker with text entry.

The way land adjustments work:

Each parcel selected by the schedule is assigned a starting land value of $0.00
The land tables are applied in order.
After land tables are applied, adjustments are applied in order.
If adjustments match the base unit from the land table, the adjustments modify them directly: 
Multiply: whatever value per unit was used in the table, multiply it by this factor
Add: whatever value per unit was used in the table, add this to it

Once at least one land schedule has been defined (e.g., a non empty entry exists), then when the user goes to “Add a layer” in the LAYERS menu, a new option will be available. The choices will look like this:


```
Add a layer

Choose an existing data source, browse for a parquet file, 
or create a surface from a land schedule.

---------------

Existing data sources
[ something ]
[ other thing ]

---------------

Land schedules
[ something ]
[ other thing ]

---------------

[ Browse for file...]                      
                                                [ cancel ]
```

If the user picks a land schedule, there’s a follow up menu:

```
Pick a geometry source

Which data source represents your parcel map?

[ something ]
[ other thing ]

                                        [ back ] [ cancel ]
```

This then adds a special layer entry to the layers menu, which is a land schedule. It looks just like a regular layer entry, except it has a light green background and the capsule label has “land schedule: <name>” on it. This layer is always filled with values derived from the land schedule it is associated with, and can’t be switched to any other field, so under “Field to visualize” it’s always locked to “land schedule: <name>”. Otherwise it operates like any other numeric field surface. Whenever the user hits “apply” to any changes on the linked land schedule, the values for this surface are updated and repainted. The surface is not updated until the user hits “apply” in the land schedule menu.

### Inspect
Clicking the inspect tool, and then selecting a parcel, will bring up the inspect menu for that parcel. This menu doesn’t have the same window logic as “standard” windows, and instead is centered on the parcel in question:

```
   +---------+
   |         |
   |  parcel |
   |         |
   +---------+
+-------^-------+
| inspect panel |
+---------------+
```


The inspect panel shows all the characteristic values that are associated with the parcel, in a scrolling list. The user can edit these by clicking a pencil icon next to the feature, and save their change by clicking a 💾 icon that replaces the pencil. If an item has been changed, it will have a red background and an undo arrow icon to restore the value.

New stuff:
The inspect menu has a 📌icon in the upper right hand corner, which can be clicked to dock the inspect menu. When it is docked like this, it is permanently open whether there is currently a selected parcel that has inspect focus or not. If no parcel has inspect focus, it is empty. Otherwise it has the same content as when it is floating.

### Comp Finder


The comp finder is a tool/menu combination. There is a TOOL button on the toolbar menu, whose icon is the search_map.svg icon.

Clicking the comp finder button makes it the currently selected tool (alongside inspect, select, and pan). Clicking a parcel while the comp finder is the current tool gives that parcel comp-finder focus and brings up the comp-finder menu. It looks like this:

+--------------------------------------------------------+
| Comp-Finder                                            |
+--------------------------------------------------------+
|                                                        |
| ▼ Subject:                                             |<--subject
| Parcel ID: 123456                                      |
| Address: 123 Apple St                                  |
|                                                        |
| -------------------------------------------------------|
| ▼ Comp Criteria:                                       |
|                                                        |
|    Data source: [ universe.parquet ▼]                  |
|    Distance:    [ number ] [ units ▼]                  |
|                                                        |
|   +--------------+---------+------------+-----+-----+  |
|   | Field        | Subject | Tolerance  |  %  |     |  |
|   +—-------------+---------+------------|-----|-----|  |
|   | [bldg_area ▼]|    2000 |  +/-:[200] | [  ]| [x] |  |
|   | [land_area ▼]|   20000 |  +/-: [10] | [✔]| [x] |  |
|   | [age       ▼]|      40 |  +/-:  [5] | [  ]| [x] |  |
|   | [type      ▼]|       a |  [a/b/c ▼] | N/A | [x] |  |
|                                     [ add criterion ]  |
|                                                        |
| ------------------------------------------------------ |
| ▼ Comps:                                               |<--matches
|                                                        |
| [Refresh comps]                                        |
| +--+--+---------+------+------+-----+------+------+    |
| |  |id| address | bldg | land | age | qual | cond |    |
| +--+--+---------+------+------+-----+------+------+    |
| |[]|12|124 apple| +100 | +100 | +1  |  =   | +1   |    |
| |[]|13|125 apple| -100 | -100 | -3  |  =   |  =   |    |
| |[]|14|126 apple| - 50 | - 60 | -1  |  +1  |  =   |    |
| +--+--+---------+------+------+-----+------+------+    |
| Selected:                                              |
| [mark][zoom to][📄][📊]                                |
+--------------------------------------------------------+


The user selects the COMP-FINDER selection tool and then clicks a parcel on the map, which drops the COMP-FINDER pin on that parcel and sets the current comp finder subject to that parcel. Selecting any other tool will hide the COMP-FINDER pin.

The SUBJECT section will list certain facts about the parcel, if those fields have been defined:
- The parcel ID
- The situs address

The CRITERIA section will allow the user to define how a “comp” (comparable property/sale) is defined/evaluated.

First, the user must pick the data source they are comparing against. By default this is the same layer as the subject itself was sampled from, but the user can pick any data source available from a dropdown.

Second, the user must define the maximum distance from the subject within which to search for comps. No parcels beyond this distance will be considered.

Third, the user can edit the criteria field table. This is a field with five columns: “Field”, “Subject”, “Tolerance”, “%”, and a blank one that holds delete row [x] buttons.

“Subject” will show the value of that field for the selected subject property.

In any given row, the user can pick a field. If it is a numeric field, then a checkbox will appear in the “%” column, otherwise only the text N/A will be displayed there in gray. Likewise, if the field is numeric, the “Tolerance” field will have a numeric input field, which will display the text “+/-:” before it. Otherwise it will have a multi-selector dropdown that lets the user pick one or more categorical values from the chosen field, with no text before it. The last column will always hold a [x] button with a red ❌, clicking this will delete the row. Below the table is an “[add criterion]” button, aligned to the right of the table, that will add a new row when pressed.

NOTE: the user may *only* select fields that appear in BOTH the subject’s data source AND the comp criteria data source.

These inputs define the criteria by which a comp is selected. A comp is defined as passing ALL of the defined tests:
- From the specified data source
- Within specified distance of the subject parcel
- For each field criterion:
  - If numeric: comp’s value is within: (subject-range, subject+range), inclusive on both ends
  - If categorical: comp’s value is any of the specified values

If no comps have been found yet, the button will say [“Find comps”]. If comps already exist, it will say [“Refresh comps”] Whenever the user changes any of the criteria, if the criteria is “dirty,” that is, different from the criteria used to find the currently displayed comps, the table in the “COMPS” subsection will appear gray to indicate they are out of date.

Here’s the relevant section of the table:

| ---------------------------------------------------- |
| ▼ Comps:                                             |<--matches
|                                                      |
| [Refresh comps]                                      |
| +--+--+---------+------+------+-----+------+------+  |
| |[]|id| address | bldg | land | age | qual | cond |  |
| +--+--+---------+------+------+-----+------+------+  |
| |[]|12|124 apple| +100 | +100 | +1  |  =   | +1   |  |
| |[]|13|125 apple| -100 | -100 | -3  |  =   |  =   |  |
| |[]|14|126 apple| - 50 | - 60 | -1  |  +1  |  =   |  |
| +--+--+---------+------+------+-----+------+------+  |
| [mark][zoom to][📄][📊]                              |
+------------------------------------------------------+

First, it scrolls vertically if there’s too many options. Each field shows the field’s difference from the subject field in terms of +/-/=: if the field is greater than the subject it shows a + delta, if it’s smaller it’s a minus delta. If it’s exactly equal, or it’s a categorical match, it says =. If there’s an error or problem of any kind it says ERROR, and hovering the error will give the error message, if any.

Second, the checkboxes on the left column govern the buttons on the bottom. The buttons are greyed out if nothing’s checked. Clicking the check in the header checks/unchecks everything.

If at least one thing is checked, the buttons are active. [mark] will display a comp marker pin on every parcel that is checked. [zoom to] will draw a bounding box around all the comps and zoom to a view with those extents and that centroid. The [📄] button is a CSV export for the comps and the [📊] button is an EXCEL export, these buttons look and work exactly like they do in time adjustments, but the data they export is different.

The data they export looks like this:
- Columns:
  - is_subject (TRUE or FALSE, first row should be the subject and TRUE all after should be FALSE)
  - parcel id
  - address
  - [user’s chosen fields]: 
    - these show the actual value for this parcel
  - Then, delta_ versions of all the fields: 
    - these show the relative value compared to the subject
    - the subject should have deltas of zero / equality indicators for each value relative to itself, the comps should show the numeric difference and a equality/inequality indicator for categoricals
  - Only selected rows should be exported



### Settings

## New Menus

### Data 
