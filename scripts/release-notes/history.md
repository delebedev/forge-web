## 2026-10-09

### More plays stay available

- Commander games now grant one free first mulligan, and London redraws keep seven cards in hand until you choose which to bottom.
- Proliferate lets you choose specific permanents or players to receive counters, rather than applying them automatically.
- Sacrifice effects that require zero creatures (like Zodiark with only one eligible creature) no longer stall the game waiting for a choice.
- Outpost Siege's entering mode choice now resolves correctly in Browser Local play.
- Saga final chapters now resolve their sacrifice and departure cleanly, allowing multi-chapter progression and transforms to complete without getting stuck.

## 2026-10-06

### See clearer stack order and make more choices

- Fixed a server stall during automatic game processing, with a safety limit for processing that never reaches a player choice.
- Progressing Browser-mode actions are less likely to time out before they finish.
- The stack now shows the next item to resolve first, making it easier to track what is happening during complex interactions.
- Protection effects now let you choose which color to protect against, including Colorless. Previously they would just pick the first option automatically.
- Card-type choices (like choosing Creature or Land) now work correctly instead of defaulting to the first option. This affects cards like Winding Way.
- When an effect asks you to choose cards from your hand or battlefield, you can now see all valid options instead of having one selected for you.
- Foretold cards remain hidden as card backs while in exile, preserving their secret identity until cast.
- Copied permanents now preserve their identity and current characteristics through battlefield updates.
- Manifest Dread creatures no longer incorrectly show Ward abilities when face down.
- Imprinted cards stay linked to their source on the battlefield display for as long as the relationship exists.
- Annihilator triggers (like Emrakul's) now properly pause resolution to let you choose which six permanents to sacrifice before continuing.
- Untap and phasing updates now follow their actual game events more consistently.

- Poison and Energy totals are now visible beside life. Energy gains and payments update the displayed balance, and emblems remain inspectable.
- Opposition Agent searches now use the controlling player and preserve the correct exile result.
- Mandatory card choices now respect their required selection count when a response is unavailable. Optional choices can still select nothing.
- AI mana-source selection now accounts for full activation costs, fixing the Phyrexian Arena payment path with Cabal Stronghold. Arena upkeep draws a card and loses life.

## 2026-10-05

### Draft multiple sets and inspect opponent hands

- You can now start a draft for one set while another draft is active, allowing you to switch between different card pools without ending the first game.
- Copied activated abilities now display their original printed text instead of a generic label, helping you distinguish between choices granted by different sources.
- Optional cast costs such as Kicker, Offspring, and life payments now show their specific mana amounts or descriptions in the choice prompt, rather than just the keyword name.
- Cards with calculated keyword values like Kodama of the Center Tree now import correctly into deck editors and appear in search results.
- Transforming cards like Arguel's Blood Fast and Chalice of Life now offer only the abilities of their current face, preventing invalid activations before transformation.
- Menace creatures now correctly reject single-blocker declarations, ensuring combat proceeds only when legal blocking assignments are submitted.
- Spells permitted by effects like Bolas's Citadel can now be cast from the top of your library directly from a visible action rail beside your hand.
- You can choose to pay life instead of mana for Phyrexian symbols or K'rrik-granted black mana during spell casting, including for kicker costs.
- A new Game Log drawer displays recent casts, resolutions, zone changes, damage, and life changes to help track gameplay history.
- Canceling a repeated-mode spell like Eldrazi Confluence no longer consumes the spell or taps lands, preserving resources for a retry.
- Library searches for spells like Bribery now correctly target the opponent's library rather than your own.
- Commander decks can now include compatible Partner pairs, with validation supporting both commanders' color identities during import and play.
- Effects that reveal an opponent's hand (like Telepathy) now allow you to inspect those cards in live play; removing the effect hides them again.
- Equip abilities on creatures enchanted by cost-reducing effects like Strong Back can now be activated even if all your lands are tapped, provided the reduction makes the cost zero.

## 2026-10-04

### Venture into dungeons, draft a deck, and hear the board

- Venture dungeon choices now show catalog names and persistent progress on your player plate. Dungeon tiles display Scryfall art and reveal the full image on hover or focus.
- The booster draft flow is fully playable from set selection through picking packs, building a 40-card deck, and entering a pod match against an opponent.
- Board actions now play short, restrained sound effects for card handling and impacts, with shared mute and volume controls available in board options.
- Deck imports share one dialog for parsing and validation, rejecting ineligible commanders with a named error before advancing. Saved decks retain complete metadata, sideboards, and card identities through edits.
- Additional-cost choices, such as sacrificing an artifact or discarding a card, now display clear Forge descriptions in both server and browser matches instead of generic numeric prompts.
- Delve payments now correctly select graveyard cards to pay generic mana, preventing casts from stalling when eligible cards are present.
- A failed application load now shows a refresh button instead of leaving a blank page, allowing you to recover without restarting the browser.

## 2026-10-03

### Attack Sieges and choose how spells resolve

- Attack Siege battles such as Invasion of Zendikar, defeat them, and cast their transformed side.
- Choose whether to make optional spell copies, such as Sevinne's Reclamation, before choosing new targets.
- Expired keyword grants no longer bring back icons when the game state rebuilds.
- You can now choose the same mode multiple times for spells like Eldrazi Confluence.
- Prompt actions remain visible and clickable even when the stack is very tall.

## 2026-10-02

### Phased-out cards and emblems stay visible

- Phased-out permanents now remain on the battlefield as inspectable ghosts, keeping their counters and position while disabling actions until they return.
- Emblems are displayed as compact markers beside the battlefield. They remain after their creator leaves play, and you can hover or click to inspect their effects.
- Card shells in the game view now display set symbols and rarity indicators.
- Starting a server game after leaving a browser game now correctly loads card names and artwork from the server.

## 2026-10-01

### Recover interrupted games and see granted keywords

- If a Browser Local game stops unexpectedly, you can now recover the match by replaying your actions in a fresh engine.
- Card inspection now shows reminder text for keywords granted to cards, such as Flanking from Sidewinder Sliver.
- When casting spells with voting options like Selvala's Stampede, you are prompted to choose an option explicitly.
- Permanents controlled by another player (e.g., via Mind Control effects) now move correctly on the battlefield during play.

## 2026-09-30

### More plays stay available

- Play lands from your graveyard when a card such as Icetill Explorer allows it.
- Using a Treasure while two Goldspan Dragons are in play no longer stalls the game.
- Card previews stay the same size while spectating, even when they show mechanic explanations.
- Share feedback from the roadmap without signing in.

## 2026-09-28

### More reliable Browser Local starts

- Browser Local now starts more reliably across repeated or cancelled launches.

## 2026-09-27

### Clearer cards and smoother combat

- Rejected combat damage assignments remain actionable, while accepted assignments now clear promptly.
- Dense rules text stays readable and scrolls when it cannot fit on the card.
- Game setup now shows the cards in your chosen opponent's deck.
- Deck imports now recognize exported flavor names and names without accents.
- Kudos to the players who reported the combat and card-text problems fixed today, and to everyone sending detailed bug reports.

## 2026-09-26

### Faster Browser play and smoother decisions

- Battlefields now stay centered and comfortably sized on wide screens.
- Browser Local starts preparing before launch, reuses downloads across updates, and ships an engine about 19% smaller.
- Rebalanced `A-` cards now show the original artwork while retaining their correct Forge rules.
- Connected players no longer lose their mulligan choice to a timeout.
- Games no longer stall when floating mana is the only thing blocking priority.

## 2026-09-25

### Cards that explain themselves

- Inspect a card to see concise explanations of its mechanics and costs.
- Sagas, planeswalkers, battles, split and transforming cards, Rooms, Classes, and other special layouts now show faces tailored to how they play.
- Cycling, landcycling, and related triggered abilities now resolve reliably, including Chartooth Cougar's Mountaincycling.

## 2026-09-24

### Clearer optional choices

- Optional copy effects now ask whether you want to copy before you choose a permanent.
- Consecutive optional triggers now appear as separate choices, so each can be accepted or declined.

## 2026-09-23

### Browser play and smoother card interactions

- Commander and Constructed games now start in Browser Local by default on supported desktop Chrome, while server play remains available.
- Card art in your hand and on the battlefield now starts loading immediately, so visible cards appear sooner.
- Cumulative upkeep now asks whether you want to pay, charges the full age-scaled cost, and sacrifices the permanent when payment is declined or cannot be completed.
- Mana abilities with their own activation costs can now be chained together to finish paying for a spell.
- Printed and dynamically granted alternative casting costs now appear as playable options, including evoke granted by another card.
- Spells that can target either a spell or a permanent now let you choose or cancel instead of silently selecting the first target.
- Reflexive triggers now present their modal choices after costs are paid, including follow-up effects created by a sacrifice.
- Spells and abilities on the stack can now be selected as targets reliably, and resolved abilities no longer linger there.
- Secondary faces remain available to cast, and Lost Jitte's second mode correctly prevents the chosen creature from blocking.
- Attached permanents are easier to select and activate from the battlefield.

## 2026-09-18

### Thanks for helping us improve

- Thanks to everyone who submits bug reports. Your reports help us prioritize what to fix next.

## 2026-09-17

### Daily puzzle (alpha)

- Try a short Daily puzzle right in your browser, no sign-in needed. This is an early test with three puzzles that repeat, so expect a few rough edges.

## 2026-09-14

### More control over every play

- Your Full Control setting is restored after Resolve all and Pass turn.
- Deck import accepts names regardless of capitalization, plus either face name or the combined name of double-faced cards.
- Automatic mana payment now handles filters such as Mossfire Valley, fixing casts such as Ruby Medallion.
- Glarb now lets you inspect the current top card of your library. The view updates when it changes and hides the card when Glarb leaves.
- Cancel supported cost selections before committing payment.

## 2026-09-10

### Smarter stops, clearer decisions

- Abilities granted during a game now appear on the affected cards.
- Library searches now group cards clearly and support choosing the required number before continuing.
- Replacement choices now appear as normal in-game decisions.
- Turn stops now follow your selected phases, with separate controls for your turn and your opponent's.
- Abandoned games now free their place after five quiet minutes, keeping new matches available.

## 2026-09-09

### Faster turns, clearer choices

- Desktop games now keep the battlefield, hand, stack, and current choice visible together.
- Your controls become available sooner when priority returns, and dead connections no longer leave games waiting indefinitely.
- Choose X directly for variable costs, and finish sacrifice-based mana payments without ending the match.

## 2026-09-08

### Watch every play unfold

- Cards now move between zones, and opponent turns play at a readable pace instead of jumping ahead.
- Cancel supported target choices before committing.
- The live spectator table now rotates through five distinct decks.
- Quick updates no longer interrupt games already underway.

## 2026-09-07

### Reliable matches, polished play

- Rejoin your current match after a connection loss, with your hand and pending choice restored.
- Urborg and Takenuma now cast Vampire of the Dire Moon without ending the match.
- Generated tokens now show their correct names and artwork.
- Match setup, dialogs, and mobile controls have a more consistent, readable design.

## 2026-09-06

### More cards, smoother games

- Build and import decks from Forge's full card catalog.
- Your commander stays visible beside your hand while it's in the command zone.
- Fewer interruptions when you have no playable response on your opponent's turn.
- Faster first visits with fewer font downloads.
