import { config, SubstrateApis } from '@sodazone/ocelloids';
import { AbstractLevel } from 'abstract-level';

export type DB = AbstractLevel<Buffer | Uint8Array | string, string, any>;

export type DefaultSubstrateApis = SubstrateApis<
config.Configuration, config.ApiNames<config.Configuration>
>;

