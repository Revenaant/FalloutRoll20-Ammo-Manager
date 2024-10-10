/**
 * This is a Roll20 script for Fallout2d20, using the official Roll20 sheets.
 * There's two parts to it:
 * Automatic ammo reduction when firing a shot - as well as checking you have enough ammo to shoot.
 * And a validator that should sync the number on all weapons and ammo gear that use the same type of ammo, when any of those values change.
 * 
 * -------------------------------------------------------------------------------
 * SPECIAL WEAPONS
 * Example, the Syringer which uses different ammo types, or Gatling Laser, which can use Fusion Cells or Cores
 * All such cases need to be handled manually (or edit the ammo type to match something in gear).
 * 
 * PERKS
 * Unhandled perks because they're conditional: Quick Hands, Gun Fu, Accurate weapon quality.
 * Conditional extra damage perks (Black Widow/Lady Killer, Mr Sandman, Nerd Rage) - Should be handled as an attack cannot consume more than 1+fireRate ammo.
 * Weapon Type perks (Commando, Rifleman, Gunslinger, Laser Commander, Pyromaniac, Size Matters) - player should manually modify the weapon damage rating in their sheet.
 * 
 * MODS
 * Weapon mods are handled, as they modify the weapon's damage rating and fire rate in the sheet.
 * 
 * OTHER NOTES
 * Weapon names in the weapons section of the character sheet should be made unique. Otherwise the wrong weapon stats may be used.
 * Gatling - when asked to spend additional dice, player should input 2x the number they want to spend in ammo. E.g. Input 10 extra DC to use fire rate 5.
 * 
 * ISSUES
 * TODO account for stuff like Laser Muskets, which specially consume 2/3 ammo per shot. (search for "Hungry 2" in description or smth. Manually add.)
 * BUG when adding mod (308 -> .50) the ammo count updates to new value correctly, but not viceversa.
 */

function ValidateIsTemplate(msg, templateName) {
    return msg.rolltemplate === templateName;
}

// Check that this is a PC sheet, not an NPC.        
function ValidateIsPlayerCharacter(character) {
    return getAttrByName(character.id, 'sheet_type') === 'pc';
}

// Try to find the cahracter sheet out of the message content.
function GetCharacterSheet(msg) {
    const sheetNameMatch = msg.content.match(/{{sheetName=([^}]*)}}/);
    if (!sheetNameMatch)
        return null;
            
    const sheetName = sheetNameMatch[1];
    return findObjs({ type: 'character', name: sheetName })[0];
}

// Params: Character sheet to search, name of item to search, name of repeating section (list), attribute name
function GetItemRowId(character, itemName, repeatingSection, nameAttr, needsExactNameMatch) {
    // Loop through all attributes to find the item
    const itemAttrs = findObjs({
        type: 'attribute',
        characterid: character.id
    })
    .filter(attr => attr.get('name').includes(repeatingSection) 
            && attr.get('name').includes(nameAttr));
    
    let searchName = itemName;
    if (!needsExactNameMatch) {
        // For some reason, many weapons add the ammo as "0.45" or "0.308" in the weapon.ammoType section.
        searchName = itemName.startsWith('0') ? itemName.substring(1) : itemName;
        // Remove space before "mm", Fallout sheet also lists e.g. 5mm in gear, as 5 mm in weapon.ammoType. Remove space.
        searchName = searchName.replace(/(\d)\s+mm/g, '$1mm');
        // Ammo in weapon section may also be in plural. Remove trailing "s" if it exists
        searchName = searchName.replace(/s$/, '');
    }

    // Find the requested item
    let itemAttr;
    for (let attr of itemAttrs) {

        if (needsExactNameMatch) {
            if (attr.get('current').toLowerCase() === searchName.toLowerCase()) {
                itemAttr = attr;
                break;
            }
        }
        else if (attr.get('current').toLowerCase().includes(searchName.toLowerCase())) {
            itemAttr = attr;
            break;
        }
    }
    
    if (!itemAttr) {
        const characterName = character.get('name');
        const errorMessage = `ERR: Item ${searchName} not found, make sure names are the same in character sheet, and that the item is actually in the sheet`;
        const errorTemplate = `&{template:fallout_injuries} {{playerName=${characterName}}} {{injuryLocation=AMMO API ERROR}} {{injuryEffect=${errorMessage}}}`
        sendChat(characterName, errorTemplate);
        return null;
    }
    
    const rowId = itemAttr.get('name').split('_')[2];
    return rowId;
}

function GetAttributeFromRow(character, rowId, repeatingSection, attrName) {
    const attr = findObjs({
        type: 'attribute',
        characterid: character.id,
        name: `repeating_${repeatingSection}_${rowId}_${attrName}`
    })[0];

    return attr;
}

function GetValue(attribute) {
    return attribute ? attribute.get('current') : null;
}

function GetValueFromWeapon(character, weaponRowId, attrName) {
    const attr = GetAttributeFromRow(character, weaponRowId, 'pc-weapons', attrName);
    return GetValue(attr);
}

// Find the weapon used in the roll in the list of weapons
function GetWeaponRowId(msg, character) {
    const weaponNameMatch = msg.content.match(/{{weaponName=([^}]*)}}/);
    if (!weaponNameMatch)
        return null;
        
    return GetItemRowId(character, weaponNameMatch[1], 'repeating_pc-weapons', 'weapon_name', true)
}

function GetAmmoRowId(character, ammoType) {
    return GetItemRowId(character, ammoType, 'repeating_gear-ammo', 'ammo_name', false);
}

function GetAmmoSpent(msg, weaponDamage, fireRate, isGatling) {
    if (fireRate === 0)
        return 1;

    const damageRolls = msg.inlinerolls.filter(r => r.expression.indexOf("1d6cs7")  !== -1);
    let extraShots = damageRolls.length - weaponDamage;
    if (isGatling)
        extraShots /= 2;

    // We use fireRate as a cap, as there could be other effects that increase damage dice past fire rate.
    // Perks (Black Widow/Lady Killer, Mr Sandman, Nerd Rage) should be handled by this.
    let shotCount = 1 + (Math.min(extraShots, fireRate));

    // Subtract the baseline shot if we're just rolling extra dice.
    const isAdditionalRoll = !(msg.content.match(/{{showAdditional=([^}]*)}}/));
    if (isAdditionalRoll)
        shotCount -= 1;

    return shotCount;
}

// The fallout sheet doesn't sync as cleanly as we'd wish. Force the syncing of ammo in gear to ammo in weapons.
function UpdateAmmoCountInWeapons(character, ammoType, newAmmoValue) {

    if (isNaN(newAmmoValue)) {
        log("New ammo value is NaN, change prevented, this should never be called at this stage");
        return;
    }

    // Foreach weapon in pc-weapons, that has a matching ammo type, set the ammo count.
    const matchingWeapons = findObjs({
        type: 'attribute',
        characterid: character.id
    })
    .filter(attr => attr.get('name').includes('repeating_pc-weapons') 
            && attr.get('name').includes('weapon_ammo_type')
            && attr.get('current') === ammoType);

    matchingWeapons.forEach(element => {
        const rowId = element.get('name').split('_')[2];
        
        // BUG: the filtering doesn't seem to work properly, so we check in here again
        // Example case: 3 Hunting rifles, 2 using 0.308 ammo and 1 using a 0.50 cal receiver.
        const weaponAmmoType = GetValueFromWeapon(character, rowId, 'weapon_ammo_type');
        if (weaponAmmoType != ammoType)
            return;

        const ammoAttr = GetAttributeFromRow(character, rowId, 'pc-weapons', 'weapon_ammo');
        const previousQuantity = GetValue(ammoAttr);
        ammoAttr.set('current', newAmmoValue);

        log(`${character.get('name')} | SettingA: ${GetValueFromWeapon(character, rowId, 'weapon_name')} was ${previousQuantity}, now ${GetValue(ammoAttr)}`);
    });
}

function UpdateAmmoCountInGear(msg, character, ammoRowId, ammoType, ammoSpent) {
    if (ammoSpent === 0) {
        sendChat(msg.who, "No Ammo Spent");
        return;
    }

    const gearAmmoAttr = GetAttributeFromRow(character, ammoRowId, 'gear-ammo', 'ammo_quantity');
    if (!gearAmmoAttr)
        return;

    const previousQuantity = GetValue(gearAmmoAttr);
    gearAmmoAttr.set('current', parseInt(previousQuantity) - ammoSpent);
    const newQuantity = GetValue(gearAmmoAttr);
    
    UpdateAmmoCountInWeapons(character, ammoType, newQuantity);

    const characterName = character.get('name');
    const message = `${ammoType} reduced: ${previousQuantity} -> ${newQuantity}`;
    const messageTemplate = `&{template:fallout_gear} {{playerName=${characterName}}} {{gearName=${message}}} {{gearDescription=}}`
    sendChat(msg.who, messageTemplate);
}

function HandleDamageRoll(msg) {
    const character = GetCharacterSheet(msg);
    if (!character || !ValidateIsPlayerCharacter(character))
        return;
        
    const weaponRowId = GetWeaponRowId(msg, character);

    const ammoType = GetValueFromWeapon(character, weaponRowId, 'weapon_ammo_type');
    const weaponDamage = GetValueFromWeapon(character, weaponRowId, 'weapon_damage');
    const fireRate = GetValueFromWeapon(character, weaponRowId, 'weapon_fire_rate');
    const isGatling = GetValueFromWeapon(character, weaponRowId, 'weapon_qualities').includes('Gatling');

    const ammoRowId = GetAmmoRowId(character, ammoType);
    const ammoSpent = GetAmmoSpent(msg, weaponDamage, fireRate, isGatling);

    UpdateAmmoCountInGear(msg, character, ammoRowId, ammoType, ammoSpent);
}

function HandleAttackRoll(msg) {
    const character = GetCharacterSheet(msg);
    if (!character || !ValidateIsPlayerCharacter(character))
        return;

    const weaponRowId = GetWeaponRowId(msg, character);
    const ammoType = GetValueFromWeapon(character, weaponRowId, 'weapon_ammo_type');

    // Weapon uses no ammo, likely melee or thrown.
    if (!ammoType)
        return;

    const ammoCount = GetValueFromWeapon(character, weaponRowId, 'weapon_ammo');
    if (ammoCount <= 0) {
        const characterName = character.get('name');
        const errorMessage = `Not enough ${ammoType} to fire this weapon.`;
        const errorTemplate = `&{template:fallout_injuries} {{playerName=${characterName}}} {{injuryLocation=CLICK!}} {{injuryEffect=${errorMessage}}}`
        sendChat(msg.who, errorTemplate);
    }
}

function HandleWeaponAmmoChanged(character, weaponRowId, targetAmmoCount) {
    const ammoType = GetValueFromWeapon(character, weaponRowId, 'weapon_ammo_type');
    const ammoRowId = GetAmmoRowId(character, ammoType);
    
    const gearAmmoAttr = GetAttributeFromRow(character, ammoRowId, 'gear-ammo', 'ammo_quantity');
    const gearAmmoCount = GetValue(gearAmmoAttr);
    
    if (gearAmmoCount === targetAmmoCount)
        return;
    
    gearAmmoAttr.set('current', targetAmmoCount);
    UpdateAmmoCountInWeapons(character, ammoType, targetAmmoCount);
}

function HandleGearAmmoChanged(character, ammoRowId, targetAmmoCount) {
    const ammoNameAttr = GetAttributeFromRow(character, ammoRowId, 'gear-ammo', 'ammo_name');
    const ammoName = GetValue(ammoNameAttr);

    const weaponsWithAmmo = findObjs({
        type: 'attribute',
        characterid: character.id
    })
    .filter(attr => attr.get('name').includes('repeating_pc-weapons') 
                    && attr.get('name').includes('weapon_ammo_type')
                    && attr.get('current') != "");

    // Loop through all weapons to find ammoType matches.
    weaponsWithAmmo.forEach(element => {
        const rowId = element.get('name').split('_')[2];
        const weaponAmmoName = GetValueFromWeapon(character, rowId, 'weapon_ammo_type');

        // For some reason, many weapons add the ammo as "0.45" or "0.308" in the weapon.ammoType section.
        let searchName = weaponAmmoName.startsWith('0') ? weaponAmmoName.substring(1) : weaponAmmoName;
        // Remove space before "mm", Fallout sheet also lists e.g. 5mm in gear, as 5 mm in weapon.ammoType. Remove space.
        searchName = searchName.replace(/(\d)\s+mm/g, '$1mm');
        // Ammo in weapon section may also be in plural. Remove trailing "s" if it exists
        searchName = searchName.replace(/s$/, '');

        if (!ammoName.toLowerCase().includes(searchName.toLowerCase()))
            return; // js continue

        const ammoAttr = GetAttributeFromRow(character, rowId, 'pc-weapons', 'weapon_ammo');

        const previousQuantity = GetValue(ammoAttr);
        if (previousQuantity == targetAmmoCount)
            return; // js continue

        ammoAttr.set('current', parseInt(targetAmmoCount));

        log(`${character.get('name')} | SettingB: ${GetValueFromWeapon(character, rowId, 'weapon_name')} was ${previousQuantity}, now ${GetValue(ammoAttr)}`);
    });
}

on("ready", function() {
    log('=== Initialized Ammo Manager ===');
});

on("chat:message", function(msg) {
    try {
        if (!msg.inlinerolls)
            return;

        if (ValidateIsTemplate(msg, 'fallout_attacks'))
            HandleAttackRoll(msg);

        if (ValidateIsTemplate(msg, 'fallout_damage'))
            HandleDamageRoll(msg);    
    }
    catch (err) {
        log('AMMO MANAGER ERROR: ' + err.message)
    }
});

on("change:attribute", function(obj, prev) {
    try {
        const character = getObj("character", obj.get('characterid'));
        if (!ValidateIsPlayerCharacter(character))
            return;
    
        const targetAmmoCount = Number(GetValue(obj));
        if (targetAmmoCount === prev.current) {
            log("---- Value already the same " + obj.get('name'))
            return;
        }
    
        const attrName = obj.get('name');
        const isWeaponAmmoAttr = attrName.includes('weapon_ammo') && !attrName.includes('_type');
        const isGearAmmoAttr = attrName.includes('ammo_quantity');

        if (!isWeaponAmmoAttr && !isGearAmmoAttr)
            return;

        // Sometimes when adding a weapon or changing mods, text can be input into the ammo value.
        if (isNaN(targetAmmoCount) || targetAmmoCount === "" || !Number.isInteger(targetAmmoCount)) {
            obj.set('current', prev.current);
            log("----Caught NaN change attempt " + targetAmmoCount + " Back to " + prev.current);
            return;
        }
    
        // We changed the ammo count in the weapons section. Update gear and other weapons that use same ammo type.
        if (isWeaponAmmoAttr) {   
            const weaponRowId = attrName.split('_')[2];
            HandleWeaponAmmoChanged(character, weaponRowId, targetAmmoCount);
        }
        // We changed the ammo count in gear section. Update weapons that use the ammo type.
        else if (isGearAmmoAttr) {
            const ammoRowId = attrName.split('_')[2];
            HandleGearAmmoChanged(character, ammoRowId, targetAmmoCount);
        }
    }
    catch (err) {
        log('AMMO MANAGER VALIDATOR ERROR: ' + err.message)
    }
});
