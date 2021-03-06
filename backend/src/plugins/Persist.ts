import { decorators as d, IPluginOptions } from "knub";
import { GuildPersistedData, IPartialPersistData } from "../data/GuildPersistedData";
import intersection from "lodash.intersection";
import { Member, MemberOptions } from "eris";
import { GuildLogs } from "../data/GuildLogs";
import { LogType } from "../data/LogType";
import { stripObjectToScalars } from "../utils";
import { trimPluginDescription, ZeppelinPlugin } from "./ZeppelinPlugin";
import * as t from "io-ts";

const ConfigSchema = t.type({
  persisted_roles: t.array(t.string),
  persist_nicknames: t.boolean,
  persist_voice_mutes: t.boolean, // Deprecated, here to not break old configs
});
type TConfigSchema = t.TypeOf<typeof ConfigSchema>;

export class PersistPlugin extends ZeppelinPlugin<TConfigSchema> {
  public static pluginName = "persist";
  public static configSchema = ConfigSchema;

  public static pluginInfo = {
    prettyName: "Persist",
    description: trimPluginDescription(`
      Blah
    `),
  };

  protected persistedData: GuildPersistedData;
  protected logs: GuildLogs;

  public static getStaticDefaultOptions(): IPluginOptions<TConfigSchema> {
    return {
      config: {
        persisted_roles: [],
        persist_nicknames: false,
        persist_voice_mutes: false,
      },
    };
  }

  onLoad() {
    this.persistedData = GuildPersistedData.getGuildInstance(this.guildId);
    this.logs = new GuildLogs(this.guildId);
  }

  @d.event("guildMemberRemove")
  onGuildMemberRemove(_, member: Member) {
    let persist = false;
    const persistData: IPartialPersistData = {};
    const config = this.getConfig();

    const persistedRoles = config.persisted_roles;
    if (persistedRoles.length && member.roles) {
      const rolesToPersist = intersection(persistedRoles, member.roles);
      if (rolesToPersist.length) {
        persist = true;
        persistData.roles = rolesToPersist;
      }
    }

    if (config.persist_nicknames && member.nick) {
      persist = true;
      persistData.nickname = member.nick;
    }

    if (persist) {
      this.persistedData.set(member.id, persistData);
    }
  }

  @d.event("guildMemberAdd")
  async onGuildMemberAdd(_, member: Member) {
    const memberRolesLock = await this.locks.acquire(`member-roles-${member.id}`);

    const persistedData = await this.persistedData.find(member.id);
    if (!persistedData) {
      memberRolesLock.unlock();
      return;
    }

    const toRestore: MemberOptions = {};
    const config = this.getConfig();
    const restoredData = [];

    const persistedRoles = config.persisted_roles;
    if (persistedRoles.length) {
      const rolesToRestore = intersection(persistedRoles, persistedData.roles);
      if (rolesToRestore.length) {
        restoredData.push("roles");
        toRestore.roles = Array.from(new Set([...rolesToRestore, ...member.roles]));
      }
    }

    if (config.persist_nicknames && persistedData.nickname) {
      restoredData.push("nickname");
      toRestore.nick = persistedData.nickname;
    }

    if (restoredData.length) {
      await member.edit(toRestore, "Restored upon rejoin");
      await this.persistedData.clear(member.id);

      this.logs.log(LogType.MEMBER_RESTORE, {
        member: stripObjectToScalars(member, ["user", "roles"]),
        restoredData: restoredData.join(", "),
      });
    }

    memberRolesLock.unlock();
  }
}
