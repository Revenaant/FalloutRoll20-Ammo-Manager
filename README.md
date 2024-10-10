# FalloutRoll20 Ammo Manager

An automated ammo manager for your Fallout2d20 games in Roll20.

![image](https://github.com/user-attachments/assets/faa2a6f8-6a1c-43f6-b391-de18d57c1b4a)

## Why?
The official Roll20 module has some built-in automatic ammo reduction when making attacks, however I found it limited and very inconsistent (seems to only update directly after making an attack, and only once).
This script somewhat bruteforces over that functionality, as it is a closed source sheet, by checking chat messages and attribute changes, and "post-processing" for the correct values, if you will.

## What's included
**Ammo Manager**: Making damage rolls automatically subtract ammo from the chosen weapon.
* Accounts for Fire Rate when choosing to roll additional dice.
* Sends messages to show the ammo reduction in chat. Also if there's no ammo to shoot a weapon.
* Glating weapons handled (sort of, check notes at top of script).
* Rolling additional damage dice will only spend ammo if there's extra dice added as "fire rate". 
This is done because roll20 will re-roll all the dice, and then add "X" additional damage dice to the roll, but it's not what we want, assuming you correctly rolled the first time around when clicking on the button in the green attack roll message.

**Ammo Validator**: QoL change so you can update the value of ammo in one place and have it automatically update everywhere else. 
* The value in the Gear table is used as a master value and it's change propagates to weapons.
* Aditionally, changing value of ammo in Weapons section updates Gear section.
* Changing value of one ammo type updates all weapons using that ammo type.

## Notice
There are some special cases and edgecases that are not (or cannot) be handled by this script (e.g. Gatling, Mods, Perks). 
Be sure to check out the lengthy comments at the top of the file for more details.
