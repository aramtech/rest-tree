// @ts-nocheck
import env from "$/server/env.js";

const client = (await import("$/server/database/prisma.ts")).default;
const pq = (await import("$/server/database/helpers/promise_query.db.js")).default;
const log = await (await import("$/server/utils/log/index.js")).default("Tree Utility", {});

class Tree_Error extends Error {
    constructor(message, status_code = env.response.status_codes.server_error) {
        super(message);
        this.message = message;
        this.name = "TreeError";
        this.status_code = status_code;
        log("message", "Error", this.name);
    }
}

class Tree {
    treelist = {
        self: this,
        id_types: ["number", "string"],
        type: null,
        table: null,
        node_id_key: null,
        parent_id_key: null,
        parent_id_object: null,
        include: null,
        async _set_treelist_database(params) {
            try {
                async function check(params) {
                    if (typeof params.database != "object") {
                        throw new Tree_Error(
                            `\ntreelist.set params of type database must take object called database with \n- database.treelist_table_name \n- database.treelist_table_node_id_column_name\n- database.treelist_table_parent_node_id_column_name`,
                        );
                    }
                    if (typeof params.database.treelist_table_name != "string") {
                        throw new Tree_Error(
                            `\ntreelist.set params database.treelist_table_name is required of type string \n\ntreelist table name is the table name obviously 😠`,
                        );
                    }
                    if (typeof params.database.treelist_table_node_id_column_name != "string") {
                        throw new Tree_Error(
                            `\ntreelist.set params database.treelist_table_node_id_column_name is required of type string\n\ntreelist table node id column name is column name identify the tree node obviously 😠`,
                        );
                    }
                    if (typeof params.database.treelist_table_parent_node_id_column_name != "string") {
                        throw new Tree_Error(
                            `\ntreelist.set params database.treelist_table_parent_node_id_column_name is required of type string \n\ntreelist table parent node id column name is the parent identifier for a node obviously 😠`,
                        );
                    }

                    if (!client[params.database.treelist_table_name]) {
                        throw new Tree_Error(`\ntreelist table does_not exists`);
                    }
                    const query = `DESCRIBE ${params.database.treelist_table_name}`;
                    const fields = (await pq(query)).map((el) => el.Field);
                    log(fields);
                    if (!fields.includes(params.database.treelist_table_node_id_column_name)) {
                        throw new Tree_Error(`\ntreelist table, node id column name is not in the treelist table columns`);
                    }
                    if (!fields.includes(params.database.treelist_table_parent_node_id_column_name)) {
                        throw new Tree_Error(`\ntreelist table, parent id column name is not in the treelist table columns`);
                    }
                }
                await check(params);
                this.type = "database";
                this.table = params.database.treelist_table_name;
                this.node_id_key = params.database.treelist_table_node_id_column_name;
                this.parent_id_key = params.database.treelist_table_parent_node_id_column_name;
                this.parent_id_object = params.database.treelist_table_parent_node_id_object_column;
                this.include = params.database.include;
            } catch (error) {
                console.log(error);
                this.type = null;
                throw new Tree_Error(error.message);
            }
        },

        async set(params) {
            await this._set_treelist_database(params);
        },

        // if type then set, otherwise throw
        async _validate_isSet() {
            if (!this.type) {
                throw new Tree_Error("Treelist is Not Set");
            }
        },

        // queries the node from table
        async get_node(node_id) {
            await this._validate_isSet();

            if (!node_id || !this.id_types.includes(typeof node_id)) {
                throw new Tree_Error(`node_id must be provided and must be either number or string`, env.response.status_codes.invalid_field);
            }

            const node = await client[this.table].findFirst({
                where: {
                    deleted: false,
                    [this.node_id_key]: parseInt(node_id),
                },
                include: this.include,
            });
            if (!node) {
                throw new Tree_Error(`node with id ${node_id} was not found`, env.response.status_codes.not_found);
            }
            return node;
        },

        // return path to a node from root
        async get_path_to_node(node_id) {
            await this._validate_isSet();
            const path = [];
            let current_node_id = node_id;
            while (!!current_node_id) {
                path.unshift(current_node_id);
                current_node_id = (await this.get_node(current_node_id))?.[this.parent_id_key];
            }
            return path;
        },

        // get root node
        // returns root node_id if exists
        // and if given node id has no parent then will return null
        async get_root(node_id) {
            await this._validate_isSet();
            const node_path = await this.get_path_to_node(node_id);
            return node_path[0];
        },

        // returns array of all treelist
        async get_list_copy() {
            await this._validate_isSet();
            const list = await client[this.table].findMany({
                where: {
                    deleted: false,
                },
                include: this.include,
            });
            return list;
        },

        async insert_node(node) {
            try {
                await log(`\ncreating node\nprovided data is\nnode:${JSON.stringify(node, null, 4)}`);

                node[this.parent_id_key] = parseInt(node[this.parent_id_key]) || undefined;

                await this._validate_isSet();

                if (
                    !!node[this.parent_id_key] &&
                    !(await client[this.table].findFirst({
                        where: {
                            deleted: false,
                            [this.node_id_key]: parseInt(node[this.parent_id_key]),
                        },
                    }))
                ) {
                    throw new Tree_Error(`node parent id ${node[this.parent_id_key]} does_not exist`, env.response.status_codes.not_found);
                }

                const new_node = await client[this.table].create({
                    data: {
                        ...node,
                        [this.parent_id_object]: !node[this.parent_id_key]
                            ? undefined
                            : {
                                  connect: {
                                      [this.node_id_key]: node[this.parent_id_key],
                                  },
                              },
                        deleted: false,
                        [`created_by_user`]: {
                            connect: {
                                user_id: node.created_by_user || 1,
                            },
                        },
                        [`updated_by_user`]: {
                            connect: {
                                user_id: node.updated_by_user || node.created_by_user || 1,
                            },
                        },
                    },
                });

                if (this.self.tree.tree) {
                    if (!node[this.parent_id_key]) {
                        this.self.tree.tree.push(new_node);
                    } else {
                        const parent_node = await this.self.tree.get_node_from_tree(new_node[this.parent_id_key], this.self.tree.tree);
                        if (!parent_node.children) {
                            parent_node.children = [];
                        }
                        parent_node.children.push(new_node);
                    }
                }
                return new_node;
            } catch (error) {
                console.log(error);
                throw new Tree_Error(error.message);
            }
        },

        async update_node_parent(node_id, new_parent_id) {
            await this._validate_isSet();
            try {
                await this._validate_isSet();

                let old_parent_id = null;

                const node = await client[this.table].findFirst({
                    where: {
                        deleted: false,
                        [this.node_id_key]: parseInt(node_id),
                    },
                });
                // check
                if (!node) {
                    throw new Tree_Error(`there is no node with identifier ${this.node_id_key} = ${node_id}`, env.response.status_codes.not_found);
                }

                if (!!new_parent_id) {
                    if (
                        !(await client[this.table].findFirst({
                            where: {
                                deleted: false,
                                [this.node_id_key]: parseInt(new_parent_id),
                            },
                        }))
                    ) {
                        throw new Tree_Error(
                            `parent node identified by ${this.node_id_key} = ${new_parent_id} does_not exist`,
                            env.response.status_codes.not_found,
                        );
                    }
                    const path_to_new_parent = await this.get_path_to_node(new_parent_id);
                    if (path_to_new_parent.includes(node_id)) {
                        throw new Tree_Error(
                            `updating on this manner will cause loop, path to parent ${new_parent_id} from root includes the node it self ${node_id}\npath to new parent= ${path_to_new_parent}`,
                            env.response.status_codes.conflict,
                        );
                    }
                }

                old_parent_id = node[this.parent_id_key];

                if (old_parent_id == new_parent_id) {
                    throw new Tree_Error(`old parent id is matching the new parent id [${old_parent_id}]`, env.response.status_codes.invalid_field);
                }

                const old_path = await this.get_path_to_node(node_id);

                // update
                await client[this.table].updateMany({
                    where: {
                        deleted: false,
                        [this.node_id_key]: parseInt(node_id),
                    },
                    data: {
                        [this.parent_id_key]: new_parent_id || null,
                    },
                });

                // at this point the treelist has been updated with the new parent_id, and obtained the old parent_id
                if (!!this.self.tree?.tree) {
                    const node = await this.self.tree.get_node_from_tree(old_path, this.self.tree.tree);

                    const old_parent_children_list = old_parent_id
                        ? (await this.self.tree.get_node_from_tree(old_parent_id, this.self.tree.tree)).children
                        : this.self.tree.tree;

                    let new_parent_children_list;
                    if (!new_parent_id) {
                        new_parent_children_list = this.self.tree.tree;
                    } else {
                        const parent = await this.self.tree.get_node_from_tree(new_parent_id, this.self.tree.tree);
                        if (!Array.isArray(parent.children)) {
                            parent.children = [];
                        }
                        new_parent_children_list = parent.children;
                    }

                    // removal
                    const old_index = old_parent_children_list.findIndex((el) => el[this.node_id_key] == node_id);
                    old_parent_children_list.splice(old_index, 1);

                    // adding
                    if (
                        !new_parent_children_list.find((child) => {
                            return child[this.node_id_key] == node[this.node_id_key];
                        })
                    ) {
                        new_parent_children_list.push(node);
                    }
                }
            } catch (error) {
                console.log(error);
                throw new Tree_Error(error.message);
            }
        },

        async get_children_list(node_id, direct = false) {
            await this._validate_isSet();
            try {
                const children = [];
                const node = await client[this.table].findFirst({
                    where: {
                        deleted: false,
                        [this.node_id_key]: parseInt(node_id),
                    },
                });

                if (!node) {
                    throw new Tree_Error("not found", env.response.status_codes.not_found);
                }

                const direct_children = await client[this.table].findMany({
                    where: {
                        deleted: false,
                        [this.parent_id_key]: parseInt(node_id),
                    },
                });
                if (direct == true) {
                    return direct_children;
                }
                children.push(...direct_children);

                for (const node of direct_children) {
                    children.push(...(await this.get_children_list(node[this.node_id_key])));
                }
                return children;
            } catch (error) {
                console.log(error);

                throw error;
            }
        },
    };
    tree = {
        self: this,
        tree: null,
        async load_tree_to_root(nodes_ids, place_content) {
            try {
                const all_nodes_ids = [];
                let treelist = [];
                const paths = {};
                for (const node_id of nodes_ids) {
                    const path = await this.self.treelist.get_path_to_node(node_id);

                    paths[node_id] = path;

                    // pushing path filtered by skipping repeated nodes ids only to array of nodes_ids
                    all_nodes_ids.push(
                        ...path.filter((node_id_from_path) => {
                            return !all_nodes_ids.includes(node_id_from_path);
                        }),
                    );

                    // pushing children of main nodes to treelist
                    const children_list = await this.self.treelist.get_children_list(node_id);

                    treelist.push(...children_list);
                }

                // pushing the rest of nodes_ids to treelist
                treelist.push(
                    ...(await client[this.self.treelist.table].findMany({
                        where: {
                            [this.self.treelist.node_id_key]: {
                                in: all_nodes_ids.filter((node_id) => {
                                    return !treelist.find((node) => {
                                        node[this.self.treelist.node_id_key] == node_id;
                                    });
                                }),
                            },
                        },
                    })),
                );

                let clean_treelist = [];
                for (const node of treelist) {
                    if (!clean_treelist.find((clean_node) => clean_node[this.self.treelist.node_id_key] == node[this.self.treelist.node_id_key])) {
                        clean_treelist.push(node);
                    }
                }
                treelist = clean_treelist;

                // creating array of roots

                const tree = treelist.filter((node) => {
                    return !node[this.self.treelist.parent_id_key];
                });

                // loading the tree of each root with treelist set to treelist
                for (const root of tree) {
                    const [new_node, _treelist] = await this.load_node_tree_from_treelist(root, treelist);
                }

                if (Array.isArray(place_content) || place_content === true) {
                    await this.self.content.place_content(
                        treelist.filter((node) => nodes_ids.includes(node[this.self.treelist.node_id_key])),
                        place_content,
                    );
                }

                return tree;
            } catch (error) {
                console.log(error);

                await log(JSON.stringify(error, null, 4), "Error", "Tree error");
                throw error;
            }
        },

        async load_node_tree_from_treelist(node, treelist, root = true) {
            try {
                if (this.self.treelist.id_types.includes(typeof node)) {
                    node = await this.self.treelist.get_node(node);
                }
                if (treelist === undefined) {
                    treelist = await this.self.treelist.get_children_list(node[this.self.treelist.node_id_key]);
                }

                const children = [];
                children.push(...treelist.filter((el) => el[this.self.treelist.parent_id_key] == node[this.self.treelist.node_id_key]));
                for (const child_node of children) {
                    await this.load_node_tree_from_treelist(child_node, treelist, false);
                }
                node.children = children;
                if (!root) {
                    return treelist;
                } else {
                    return [node, treelist];
                }
            } catch (error) {
                console.log(error);

                throw new Tree_Error(error.message);
            }
        },
        async load_tree() {
            try {
                this.self.treelist._validate_isSet();
                let treelist = await this.self.treelist.get_list_copy();
                const tree = [];
                tree.push(...treelist.filter((el) => !el[this.self.treelist.parent_id_key]));
                // treelist = treelist.filter(
                //   (el) => !!el[this.self.treelist.parent_id_key]
                // );
                for (const node of tree) {
                    const [_return_node, _treelist] = await this.load_node_tree_from_treelist(node, treelist);
                    // treelist = _treelist;
                }
                this.tree = tree;
                return tree;
            } catch (error) {
                console.log(error);

                throw new Tree_Error(error.message);
            }
        },
        async _validate_isSet() {
            if (!this.tree) {
                throw new Tree_Error(`tree is not loaded`);
            }
        },
        async get_node_from_tree(path_arr, tree = this.tree) {
            await this._validate_isSet();
            if (this.self.treelist.id_types.includes(typeof path_arr)) {
                path_arr = await this.self.treelist.get_path_to_node(path_arr);
            }
            const current_id = path_arr.shift();
            const current_node = tree.filter((node) => node[this.self.treelist.node_id_key] == current_id)[0];
            if (!current_node) {
                throw new Tree_Error(`node of path not found ${current_id}\nremaining path: ${path_arr}`, env.response.status_codes.not_found);
            }
            if (!path_arr.length) {
                return current_node;
            }
            return await this.get_node_from_tree(path_arr, current_node.children || []);
        },
        async get_parent_node(node_id) {
            await this._validate_isSet();
            try {
                const node = await this.get_node_from_tree(node_id);
                if (!node[this.self.treelist.parent_id_key]) {
                    return this.tree;
                }
                const parent_node = await this.get_node_from_tree(node[this.self.treelist.parent_id_key]);
                return parent_node;
            } catch (error) {
                console.log(error);

                throw new Tree_Error(error.message);
            }
        },
    };
    content = {
        self: this,
        type: null,
        content_table: null,
        content_id_key: null,
        content_relations_array: null,
        relation_table: null,
        relation_to_content_object: null,
        relation_to_content_key: null,
        relation_to_node_object: null,
        relation_to_node_key: null,
        async set(load_content_to_tree, db) {
            await this.self.treelist._validate_isSet();
            this.type = "database";
            this.content_table = db.content_table;
            this.content_id_key = db.content_id_key;
            this.content_relations_array = db.content_relations_array;
            this.relation_table = db.relation_table;
            this.relation_to_content_object = db.relation_to_content_object;
            this.relation_to_content_key = db.relation_to_content_key;
            this.relation_to_node_object = db.relation_to_node_object;
            this.relation_to_node_key = db.relation_to_node_key;
            if (load_content_to_tree && this.self.tree.tree) {
                await this.place_content(this.self.tree.tree);
            }
        },
        // get content tree to root by placement on tree
        async fetch_tree_to_root_by_relations(relation_content_list) {
            try {
                await this._validate_isSet();
                const nodes_ids = (
                    await client[this.relation_table].findMany({
                        where: {
                            [this.relation_to_content_key]: {
                                in: relation_content_list,
                            },
                            deleted: false,
                        },
                    })
                ).map((el) => el[this.relation_to_node_key]);
                const tree = await this.self.tree.load_tree_to_root(nodes_ids, relation_content_list);
                return tree;
            } catch (error) {
                console.log(error);

                await log(JSON.stringify(error, null, 4), "Error", "tree error");
                throw error;
            }
        },
        async _validate_isSet() {
            await this.self.treelist._validate_isSet();
            if (!(!!this.type && !!this.relation_to_node_key && !!this.relation_to_content_object)) {
                throw new Tree_Error(`Content is not set, use <tree>.treelist.load_content async function to load content `);
            }
        },
        // place content of given tree, or default tree
        /**
         *
         * @param {*} tree
         * @param {*} src
         *
         * @description
         *
         * place content of given tree, or default tree
         * you can specify certain content to be placed
         */
        async place_content(tree = this.self.tree.tree, src = undefined, direct = false) {
            await this._validate_isSet();
            for (const node of tree || []) {
                node.content = await client[this.relation_table].findMany({
                    where: {
                        deleted: false,
                        [this.relation_to_node_object]: {
                            [this.self.treelist.node_id_key]: parseInt(node[this.self.treelist.node_id_key]),
                            deleted: false,
                        },
                        [this.relation_to_content_object]: {
                            deleted: false,
                            [this.content_id_key]: !!src?.length
                                ? {
                                      in: src,
                                  }
                                : undefined,
                        },
                    },
                    include: {
                        [this.relation_to_content_object]: true,
                    },
                });
                // .map((el) => el[this.relation_to_content_object]);
                if (!direct && node.children?.length > 0) {
                    await this.place_content(node.children);
                }
            }
        },
        /**
         *
         * @param {*} params
         * @returns
         *
         * @example
         *
         *
         *
         *
         *
         * add_content(params={
         *       content:[
         *           {
         *               update: false,
         *               data: {
         *                   // ... id
         *               },
         *               relation_flag:'',// override, append, remove
         *               nodes:[], // nodes ids
         *           }
         *       ]
         *   })
         */
        async add_content(
            params = {
                content: [
                    {
                        update: false,
                        data: {
                            // ... id
                        },
                        relation_flag: "", // override, append, remove
                        nodes: [], //
                    },
                ],
            },
        ) {
            // validate the content is set
            await this._validate_isSet();
            try {
                for (const item of params.content) {
                    // make sure that nodes exists if nodes is set
                    if (item.nodes && Array.isArray(item.nodes)) {
                        // make sure that ids are valid
                        if (!item.nodes.every((id) => ["number", "string"].includes(typeof id))) {
                            throw new Tree_Error("Node ids must be either number or string", env.response.status_codes.invalid_field);
                        }

                        // make sure tha all nodes exists
                        const nodes = await client[this.self.treelist.table].findMany({
                            where: {
                                deleted: false,
                                [this.self.treelist.node_id_key]: {
                                    in: item.nodes.map((id) => parseInt(id)),
                                },
                            },
                        });
                        if (nodes.length != item.nodes.length) {
                            throw new Tree_Error("Invalid Nodes Ids (NOT FOUND)", env.response.status_codes.not_found);
                        }
                    }

                    // check if the element exists or not
                    // and create or fetch it
                    let item_from_db = null;
                    if (item.data[this.content_id_key]) {
                        item_from_db = await client[this.content_table].findFirst({
                            where: {
                                [this.content_id_key]: parseInt(item.data[this.content_id_key]),
                                deleted: false,
                            },
                        });
                        if (item_from_db && item.update === true) {
                            item_from_db = await client[this.content_table].update({
                                where: {
                                    [this.content_id_key]: item.data[this.content_id_key],
                                },
                                data: {
                                    ...item.data,
                                    [this.content_id_key]: undefined,
                                },
                            });
                        }
                    }
                    if (!item_from_db) {
                        item_from_db = await client[this.content_table].create({
                            data: item.data,
                        });
                    }

                    if (item.nodes && Array.isArray(item.nodes)) {
                        if (item.relation_flag === undefined || item.relation_flag == "override") {
                            // fetch old node ids placements for this item
                            const relations_to_nodes_ids = (
                                await client[this.relation_table].findMany({
                                    where: {
                                        [this.relation_to_content_key]: parseInt(item_from_db[this.content_id_key]),
                                        deleted: false,
                                    },
                                })
                            ).map((relation) => relation[this.relation_to_node_key]);

                            const to_be_deleted = relations_to_nodes_ids.filter((id) => {
                                !item.nodes.includes(id);
                            });
                            const to_be_inserted = item.nodes.filter((id) => {
                                !relations_to_nodes_ids.includes(id);
                            });

                            // delete old relations
                            to_be_deleted.length &&
                                (await client[this.relation_table].updateMany({
                                    where: {
                                        [this.relation_to_content_key]: parseInt(item_from_db[this.content_id_key]),
                                        [this.relation_to_node_key]: {
                                            in: to_be_deleted,
                                        },
                                        deleted: false,
                                    },
                                    data: {
                                        deleted: true,
                                    },
                                }));

                            // insert relations
                            to_be_inserted.length &&
                                (await client[this.relation_table].createMany({
                                    data: to_be_inserted.map((node_id) => {
                                        return {
                                            [this.relation_to_content_key]: item_from_db[this.content_id_key],
                                            [this.relation_to_node_key]: node_id,
                                            deleted: false,
                                        };
                                    }),
                                }));

                            // check if tree exists and if so update content
                            if (this.self.tree.tree) {
                                const nodes = [];
                                for (const node_id of [...new Set([...item.nodes, ...relations_to_nodes_ids])]) {
                                    nodes.push(await this.self.tree.get_node_from_tree(node_id));
                                }
                                await this.self.content.place_content(nodes, undefined, true);
                            }
                        } else if (item.relation_flag == "append") {
                            // fetch old node ids placements for this item
                            const relations_to_nodes_ids = (
                                await client[this.relation_table].findMany({
                                    where: {
                                        [this.relation_to_content_key]: parseInt(item_from_db[this.content_id_key]),
                                        deleted: false,
                                    },
                                })
                            ).map((relation) => relation[this.relation_to_node_key]);

                            item.appended_nodes_ids = item.nodes.filter((node_id) => {
                                return !relations_to_nodes_ids.includes(node_id);
                            });

                            // insert relations
                            item.appended_nodes_ids.length &&
                                (await client[this.relation_table].createMany({
                                    data: item.appended_nodes_ids.map((node_id) => {
                                        return {
                                            [this.relation_to_content_key]: item_from_db[this.content_id_key],
                                            [this.relation_to_node_key]: node_id,
                                            deleted: false,
                                        };
                                    }),
                                }));

                            // check if tree exists and if so update content
                            if (this.self.tree.tree) {
                                const nodes = [];
                                for (const node_id of [...new Set([...item.nodes, ...relations_to_nodes_ids])]) {
                                    nodes.push(await this.self.tree.get_node_from_tree(node_id));
                                }
                                await this.self.content.place_content(nodes, undefined, true);
                            }
                        } else if (item.relation_flag == "remove") {
                            // fetch old node ids placements for this item
                            const relations_to_nodes_ids = (
                                await client[this.relation_table].findMany({
                                    where: {
                                        [this.relation_to_content_key]: parseInt(item_from_db[this.content_id_key]),
                                        deleted: false,
                                    },
                                })
                            ).map((relation) => relation[this.relation_to_node_key]);

                            // delete old relations
                            await client[this.relation_table].updateMany({
                                where: {
                                    [this.relation_to_content_key]: item_from_db[this.content_id_key],
                                    deleted: false,
                                },
                                data: {
                                    deleted: true,
                                },
                            });

                            // check if tree exists and if so update content
                            if (this.self.tree.tree) {
                                const nodes = [];
                                for (const node_id of [...new Set([...relations_to_nodes_ids])]) {
                                    nodes.push(await this.self.tree.get_node_from_tree(node_id));
                                }
                                await this.self.content.place_content(nodes, undefined, true);
                            }
                        } else {
                            throw new Tree_Error("Invalid flag", env.response.status_codes.invalid_field);
                        }
                    }
                }
                return params;
            } catch (error) {
                console.log(error);
                await log(JSON.stringify(error.msg, null, 4), "Error", "Tree Add Content Error");
                throw new Tree_Error(error.msg);
            }
        },

        /**
         *
         * @param {*} item_id
         * @param {*} node_ids
         *
         * @example
         * await authorities_tree.content.delete_content_relations(null, [group.group_id]); // delete all content of node
         *
         * // or
         *
         * await authorities_tree.content.delete_content_relations(authority_id, null); // delete item from all nodes contents
         *
         * // or
         *
         * await authorities_tree.content.delete_content_relations(authority_id, [group_id]); // delete item from given nodes
         *
         *
         */
        async delete_content_relations(item_id, node_ids) {
            await this._validate_isSet();
            if (!["number", "string"].includes(typeof item_id)) {
                throw new Tree_Error("invalid item_id", env.response.status_codes.invalid_field);
            }
            if (!item_id && !!node_ids) {
                for (const node_id of node_ids) {
                    if (this.self.tree.tree) {
                        await client[this.relation_table].updateMany({
                            where: {
                                deleted: false,
                                [this.relation_to_node_key]: parseInt(node_id),
                            },
                            data: {
                                deleted: true,
                            },
                        });

                        const node = this.self.tree.get_node_from_tree(node_id);
                        node.content && (node.content = []);
                    }
                }
            } else if (!!node_ids) {
                if (!node_ids.every((el) => ["number", "string"].includes(typeof el))) {
                    throw new Tree_Error(`invalid node_ids`, env.response.status_codes.invalid_field);
                }
                const nodes = await client[this.self.treelist.table]
                    .findMany({
                        where: {
                            deleted: false,
                            [this.self.treelist.node_id_key]: {
                                in: node_ids.map((id) => parseInt(id)),
                            },
                        },
                    })
                    .map((el) => el[this.self.treelist.node_id_key]);
                if (nodes.length != node_ids.length) {
                    throw new Tree_Error(
                        `\nsome nodes doesn't exists\nall node ids: ${node_ids}\nnot existing node ids: ${node_ids.filter((el) => !nodes.includes(el))}`,
                        env.response.status_codes.not_found,
                    );
                }
                const relation_node_ids = (
                    await client[this.relation_table].findMany({
                        where: {
                            deleted: false,
                            [this.relation_to_content_key]: parseInt(item_id),
                        },
                    })
                ).map((el) => el[this.relation_to_node_key]);
                const not_existing_relations = nodes.filter((el) => !relation_node_ids.includes(el));
                if (not_existing_relations.length) {
                    await log(
                        `
          some relation required to be deleted doesn't exists.
          item id: ${item_id}
          node_ids to be deleted from relations: ${nodes}
          not existing relations node ids: ${not_existing_relations}
        `,
                        "Warning",
                        `Removing relation from tree on ${this.relation_table}`,
                    );
                }

                const existing_relations = nodes.filter((el) => relation_node_ids.includes(el));

                await client[this.relation_table].updateMany({
                    where: {
                        deleted: false,
                        [this.relation_to_content_key]: parseInt(item_id),
                        [this.relation_to_node_key]: {
                            in: existing_relations,
                        },
                    },
                    data: {
                        deleted: true,
                    },
                });

                if (this.self.tree.tree) {
                    for (const node_id of existing_relations) {
                        const node = await this.self.tree.get_node_from_tree(node_id);
                        if (Array.isArray(node.content)) {
                            node.content = node.content.filter((el) => el[this.relation_to_content_object][this.content_id_key] != item_id);
                        }
                    }
                }
            } else {
                const relation_node_ids = (
                    await client[this.relation_table].findMany({
                        where: {
                            deleted: false,
                            [this.relation_to_content_object]: parseInt(item_id),
                        },
                    })
                ).map((el) => el[this.relation_to_node_key]);

                await client[this.relation_table].deleteMany({
                    where: {
                        deleted: false,
                        [this.relation_to_content_key]: parseInt(item_id),
                    },
                });
                if (this.self.tree.tree) {
                    for (const node_id of relation_node_ids) {
                        const node = await this.self.tree.get_node_from_tree(node_id);
                        if (Array.isArray(node.content)) {
                            node.content = node.content.filter((el) => el[this.relation_to_content_object][this.content_id_key] != item_id);
                        }
                    }
                }
            }
        },
        async get_content_with_no_relations() {
            try {
                const content = await client.authorities.findMany({
                    where: {
                        deleted: false,
                    },
                    include: {
                        [this.content_relations_array]: {
                            where: {
                                deleted: false,
                            },
                        },
                    },
                });
                const unrelated_content = content.filter((el) => {
                    return !el[this.content_relations_array].length;
                });

                return [unrelated_content, content];
            } catch (error) {
                console.log(error);
                throw error;
            }
        },
    };
}

export default Tree;
