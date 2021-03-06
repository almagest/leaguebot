'use strict';

import {Config, sequelize} from "../datastore";
import {BotConfig} from "../common";
import Commands from "../commands";
import Provider from "../providers/discord";

module.exports = (robot) => {

    //if (!process.env.LEAGUE_BOT_ENABLED) return;

    const setup = () => {
        Object.keys(Commands.registry).forEach(key => {
            let command = Commands.registry[key];
            command.mount(robot);
        });

    };
    if (process.env.NODE_ENV !== 'test') {
        sequelize.sync().then(async () => {
            let config = await Config.findOne();
            if (!config) {
                config = await Config.create(BotConfig)

            }

            robot.brain.set('provider', Provider);
            robot.brain.set('config', config);
            return setup();
        })
    } else {
        return setup();
    }


};


