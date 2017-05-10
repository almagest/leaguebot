import BaseCommand from "../base";
const Promise = require('bluebird');
const _ = require('lodash');
const {DataHelper} = require('./bungie-data-helper');
const request = require('request');
const constants = require('./showoff-constants')
request.debug = true;
const SHOW_ARMOR = true;


function GunsmithError(message, extra) {

    this.name = this.constructor.name;
    this.message = message;
    this.extra = extra;
    Error.captureStackTrace(this, this.constructor);
}
require('util').inherits(GunsmithError, Error);
export default class GunsmithBaseCommand extends BaseCommand {

    xbox = ['xbox', 'xb1', 'xbox1', 'xboxone', 'xbox360', 'xb360', 'xbone', 'xb'];
    playstation = ['psn', 'playstation', 'ps', 'ps3', 'ps4', 'playstation3', 'playstation4'];

    dataHelper = new DataHelper();

    constructor(robot) {
        super(robot, 'gunsmith.root')
    }


    init() {
        this._pattern = '\\s*(?<network>psn|xbox)?\\s*(?<name>\\w+)\\s+(?<bucket>primary|secondary|special|heavy)';


        super.init();
    }

    _matcher(message) {
        this.log.debug('Message = %j', message);
        return super._matcher(message)
    }

    _createPatterns() {
        let patterns = super._createPatterns();
        patterns.public = patterns.public.replace('!league ', '!');
        return patterns;
    }

    async _handle(resp) {
        let {network, name, bucket} = resp.match.groups;


        let membershipType = this._resolveNetworkType(network);

        let player, characterId, itemId, details;
        try {
            player = await
                this._resolveId(membershipType, name);
        } catch (e) {

            return this._handleError(resp, e)
        }

        this.log.debug('player %j', player);

        try {
            characterId = await
                this._getCharacterId(player.platform, player.id)
        } catch (e) {

            return this._handleError(resp, e)

        }


        try {
            itemId = await  this._getItemIdFromSummary(
                player.platform, player.id,
                characterId, this._getBucket(bucket))
        } catch (e) {

            return this._handleError(resp, e)
        }

        try {
            details = await this._getItemDetails(
                player.platform, player.id, characterId, itemId);
        } catch (e) {

            return this._handleError(resp, e)
        }

        let message = this.dataHelper.parsePayload(details);
        this.log.debug('message = %j', message);
        return resp.send(message)


    }

    _handleError(resp, e) {
        this.log.error(e.stack || e);
        resp.envelope.room = resp.envelope.user.id;
        return resp.send(this.text.error
            .add(e.message).e)
    }

    _resolveNetworkType(network) {
        if (this.xbox.includes(network)) return 1;
        if (this.playstation.includes(network)) return 2;
        return null;
    }

    async _resolveId(membershipType, name) {
        if (membershipType) {
            return this._getPlayerId(membershipType, name)
        }
        return Promise.all([
            this._getPlayerId(1, name.split('_').join(' ')),
            this._getPlayerId(2, name)
        ]).then(results => {
            if (results[0] && results[1]) {
                throw new GunsmithError(`Mutiple platforms found for: ${name}. use "xbox" or "playstation`);
            }
            if (results[0]) {
                return {
                    platform: 1,
                    id: results[0]
                }
            } else if (results[1]) {
                return {
                    platform: 1,
                    id: results[0]
                }
            }
            throw new GunsmithError(`Could not find guardian with name: ${name} on either platform.`)
        })
    }

    async _getPlayerId(membershipType, name) {
        const endpoint = `SearchDestinyPlayer/${membershipType}/${name}`;
        let networkName = membershipType === 1 ? 'xbox' : 'psn';
        return this.api(endpoint)
            .then(resp => {
                if (!resp) throw new GunsmithError(`Could not find guardian with name: ${name} on ${networkName}.`)
                let [data] = resp;
                return data && data.membershipId ? {
                    platform: membershipType,
                    id: data.membershipId
                } : null

            })
    }

    async _getCharacterId(membershipType, playerId) {
        const endpoint = `${membershipType}/Account/${playerId}`;
        return this.api(endpoint)
            .then(resp => {
                if (!resp) {
                    throw new GunsmithError('Something went wrong, no characters found for this user.')
                }

                console.log(resp);
                let [character] = resp.data.characters;
                return character.characterBase.characterId
            })
    }

    async _getItemIdFromSummary(membershipType, playerId, characterId, bucket) {
        const endpoint = `${membershipType}/Account/${playerId}/Character/${characterId}/Inventory/Summary`;
        this.log.debug('getItemIdFromSummary(%s,%s,%s,%s)', membershipType, playerId, characterId, bucket);
        this.log.debug('endpoint = %s params = none', endpoint);
        return this.api(endpoint)
            .then(resp => {

                let {items} = resp.data;

                this.log.debug('Items =%j bucket = %s', items, bucket);
                let item = _.find(items, object => {
                    return object.bucketHash === bucket;
                });

                if (!item)
                    throw new GunsmithError("Something went wrong, couldn't find the requested item for this character.");

                return item.itemId;

            })
    }

    async  _getItemDetails(membershipType, playerId, characterId, itemInstanceId) {
        const endpoint = `${membershipType}/Account/${playerId}/Character/${characterId}/Inventory/${itemInstanceId}`;
        this.log.debug('getItemDetails(%s,%s,%s,%s)', membershipType, playerId, characterId, itemInstanceId);

        const params = 'definitions=true';
        this.log.debug('endpoint = %s params = %s', endpoint, params);
        return this.api(endpoint, params)
            .then(resp => {
                return this.dataHelper.serializeFromApi(resp)
            })
    }

    _getBucket(slot) {
        switch (slot) {
            case 'primary':
                return constants.TYPES.PRIMARY_WEAPON;
                break;
            case 'special':
            case 'secondary':
                return constants.TYPES.SPECIAL_WEAPON;
                break;
            case 'heavy':
                return constants.TYPES.HEAVY_WEAPON;
                break;
            case 'ghost':
                if (SHOW_ARMOR) {
                    return constants.TYPES.GHOST;
                }
                break;
            case 'head':
            case 'helmet':
                if (SHOW_ARMOR) {
                    return constants.TYPES.HEAD;
                }
                break;
            case 'chest':
                if (SHOW_ARMOR) {
                    return constants.TYPES.CHEST;
                }
                break;
            case 'arm':
            case 'arms':
            case 'gloves':
            case 'gauntlets':
                if (SHOW_ARMOR) {
                    return constants.TYPES.ARMS;
                }
                break;
            case 'leg':
            case 'legs':
            case 'boots':
            case 'greaves':
                if (SHOW_ARMOR) {
                    return constants.TYPES.LEGS;
                }
                break;
            case 'class':
            case 'mark':
            case 'bond':
            case 'cape':
            case 'cloak':
                if (SHOW_ARMOR) {
                    return constants.TYPES.CLASS_ITEMS;
                }
                break;
            default:
                null;
        }
    }

    async api(endpoint, params) {
        const BUNGIE_API_KEY = process.env.BUNGIE_API_KEY;
        const baseUrl = 'https://www.bungie.net/Platform/Destiny/';
        const trailing = '/';
        const queryParams = params ? `?${params}` : '';
        const url = baseUrl + endpoint + trailing + queryParams;
        return new Promise((resolve, reject) => {
            request({
                url: url,
                headers: {
                    'X-API-Key': BUNGIE_API_KEY
                }
            }, (err, res, body) => {
                let object = JSON.parse(body);
                resolve(object.Response);
            })

        })
    }
}
