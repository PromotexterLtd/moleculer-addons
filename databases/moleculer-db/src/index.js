/*
 * moleculer-db
 * Copyright (c) 2017 Ice Services (https://github.com/ice-services/moleculer-addons)
 * MIT Licensed
 */

"use strict";

const _ = require("lodash");
const MemoryAdapter = require("./memory-adapter");

module.exports = {
	// Must overwrite it
	name: "",

	// Store adapter (NeDB adapter is the default)
	adapter: null,

	/**
	 * Default settings
	 */
	settings: {
		// Name of "_id" field
		idField: "_id",
		
		// Fields filter for result entities
		fields: null,

		// Auto populates schema
		populates: null,

		// Validator schema or a function to validate the incoming entity in "users.create" action
		entityValidator: null,

		// Default page size
		pageSize: 10,

		// Maximum page size
		maxPageSize: 100,

		// Maximum value of limit in `find` action
		maxLimit: -1
	},

	/**
	 * Actions
	 */
	actions: {
		/**
		 * Find all entities by filters
		 * 
		 * @cache true
		 */
		find: {
			cache: {
				keys: ["limit", "offset", "sort", "search", "searchFields", "query"]
			},
			params: {
				limit: { type: "number", integer: true, min: 0, optional: true, convert: true },
				offset: { type: "number", integer: true, min: 0, optional: true, convert: true },
				sort: { type: "string", optional: true },
				search: { type: "string", optional: true },
				searchFields: { type: "array", optional: true },
				query: { type: "object", optional: true }
			},
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.find(ctx, params);
			}
		},

		/**
		 * Get count of entities by filters
		 * 
		 * @cache true
		 */
		count: {
			cache: {
				keys: ["search", "searchFields", "query"]
			},
			params: {
				search: { type: "string", optional: true },
				searchFields: { type: "array", optional: true },
				query: { type: "object", optional: true }
			},			
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.count(ctx, params);
			}
		},

		/**
		 * List entities by filters and pagination results
		 * 
		 * @cache true
		 */
		list: {
			cache: {
				keys: ["page", "pageSize", "sort", "search", "searchFields", "query"]
			},
			params: {
				page: { type: "number", integer: true, min: 1, optional: true, convert: true },
				pageSize: { type: "number", integer: true, min: 0, optional: true, convert: true },
				sort: { type: "string", optional: true },
				search: { type: "string", optional: true },
				searchFields: { type: "array", optional: true },
				query: { type: "object", optional: true }
			},
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.Promise.all([
					// Get rows
					this.find(ctx, params),

					// Get count of all rows
					this.count(ctx, params)
				]).then(res => {
					return {
						// Rows
						rows: res[0],
						// Total rows
						total: res[1],
						// Page
						page: params.page,
						// Page size
						pageSize: params.pageSize,
						// Total pages
						totalPages: Math.floor((res[1] + params.pageSize - 1) / params.pageSize)
					};
				});
			}			
		},

		/**
		 * Create a new entity
		 */
		create: {
			params: {
				entity: { type: "any" }
			},			
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.create(ctx, params);
			}
		},

		/**
		 * Get entity by ID
		 * 
		 * @cache true
		 */
		get: {
			cache: {
				keys: ["id"]
			},
			params: {
				id: { type: "any" }
			},			
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.getById(ctx, params);
			}
		},

		/**
		 * Get entity by ID or IDs. For internal use only!
		 * 
		 * @cache true
		 */
		model: {
			cache: {
				keys: ["id", "populate", "fields", "resultAsObject"]
			},
			internal: true, // Doesn't be published by `moleculer-web`
			params: {
				id: { type: "any" },
				populate: { type: "boolean", optional: true },
				fields: { type: "array", optional: true },
				resultAsObject: { type: "boolean", optional: true }
			},			
			handler(ctx) {
				return this.model(ctx, ctx.params);
			}
		},

		/**
		 * Update an entity by ID
		 */
		update: {
			params: {
				id: { type: "any" },
				update: { type: "any" }
			},			
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.updateById(ctx, params);
			}
		},

		/**
		 * Remove an entity by ID
		 */
		remove: {
			params: {
				id: { type: "any" }
			},			
			handler(ctx) {
				let params = this.sanitizeParams(ctx, ctx.params);

				return this.removeById(ctx, params);
			}
		}
	},

	/**
	 * Methods
	 */
	methods: {

		/**
		 * Connect to database with adapter
		 */
		connect() {
			return this.adapter.connect().then(() => {
				// Call an 'afterConnected' handler in schema
				if (_.isFunction(this.schema.afterConnected)) {
					try {
						return this.schema.afterConnected.call(this);
					} catch(err) {
						/* istanbul ignore next */
						this.logger.error("afterConnected error!", err);
					}
				}
			});
		},

		/**
		 * Disconnect from database with adapter
		 */
		disconnect() {
			if (_.isFunction(this.adapter.disconnect))
				return this.adapter.disconnect();
		},

		/**
		 * Sanitize context parameters at `find` action
		 * 
		 * @param {Context} ctx 
		 * @param {any} origParams 
		 * @returns 
		 */
		sanitizeParams(ctx, params) {
			let p = Object.assign({}, params);

			// Convert from string to number
			if (typeof(p.limit) === "string")
				p.limit = Number(p.limit);				
			if (typeof(p.offset) === "string")
				p.offset = Number(p.offset);
			if (typeof(p.page) === "string")
				p.page = Number(p.page);				
			if (typeof(p.pageSize) === "string")
				p.pageSize = Number(p.pageSize);

			if (typeof(p.sort) === "string")
				p.sort = p.sort.replace(/,/, " ").split(" ");

			if (ctx.action.name.endsWith(".list")) {
				// Default `pageSize`
				if (!p.pageSize)
					p.pageSize = this.settings.pageSize;

				// Default `page`
				if (!p.page)
					p.page = 1;

				// Limit the `pageSize`
				if (this.settings.maxPageSize > 0 && p.pageSize > this.settings.maxPageSize)
					p.pageSize = this.settings.maxPageSize;

				// Calculate the limit & offset from page & pageSize
				p.limit = p.pageSize;
				p.offset = (p.page - 1) * p.pageSize;

				// Limit the `limit`
				if (this.settings.maxLimit > 0 && p.limit > this.settings.maxLimit)
					p.limit = this.settings.maxLimit;

			}

			return p;
		},

		/**
		 * Find all entities
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		find(ctx, params) {
			return this.adapter.find(params)
				.then(docs => this.transformDocuments(ctx, docs));
		},

		/**
		 * Get count of entities
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		count(ctx, params) {
			// Remove pagination params
			if (params && params.limit)
				params.limit = null;
			if (params && params.offset)
				params.offset = null;

			return this.adapter.count(params);
		},

		/**
		 * Create a new entity
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		create(ctx, params) {
			return this.validateEntity(params.entity)
				.then(entity => this.adapter.insert(entity))
				.then(doc => this.transformDocuments(ctx, doc))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Create many new entities
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		createMany(ctx, params) {
			return this.validateEntity(params.entities)
				.then(entities => this.adapter.insertMany(entities))
				.then(docs => this.transformDocuments(ctx, docs))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Get an entity by ID
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		getById(ctx, params) {
			const populate = params.populate != null ? params.populate : true;
			return this.model(ctx, { id: params.id, populate })
				.then(doc => this.transformDocuments(ctx, doc));
		},

		/**
		 * Get entities by IDs. For internal use!
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns 
		 */
		model(ctx, params) {
			let origDoc;
			return this.Promise.resolve(params)

				.then(({ id }) => {
					if (_.isArray(id)) {
						id = id.map(this.decodeID);
						return this.adapter.findByIds(id);
					} else {
						id = this.decodeID(id);
						return this.adapter.findById(id);
					}
				})

				.then(doc => {
					origDoc = doc;
					if (params.populate === true)
						return this.populateDocs(ctx, doc);
					return doc;
				})

				.then(doc => {
					if (params.fields !== false) {
						if (_.isArray(doc)) {
							return doc.map(item => this.filterFields(item, params.fields));
						} else {
							return this.filterFields(doc, params.fields);
						}					
					}
					return doc;
				})

				.then(json => {
					if (_.isArray(json) && params.resultAsObject === true) {
						let res = {};
						json.forEach((doc, i) => {
							const id = this.encodeID(origDoc[i][this.settings.idField]);
							res[id] = doc;
						});

						return res;
					}
					return json;
				});
		},

		/**
		 * Update an entity by ID
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns {Promise}
		 */
		updateById(ctx, params) {
			return this.adapter.updateById(this.decodeID(params.id), params.update)
				.then(doc => this.transformDocuments(ctx, doc))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Update multiple entities
		 * 
		 * @param {Context} ctx 
		 * @param {Object} params
		 * @returns {Promise}
		 */
		updateMany(ctx, params) {
			return this.adapter.updateMany(params.query, params.update)
				.then(doc => this.transformDocuments(ctx, doc))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Remove an entity by ID
		 * 
		 * @param {any} ctx 
		 * @returns {Promise}
		 */
		removeById(ctx, params) {
			return this.adapter.removeById(this.decodeID(params.id))
				.then(doc => this.transformDocuments(ctx, doc))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Remove multiple entities
		 * 
		 * @param {any} ctx 
		 * @returns {Promise}
		 */
		removeMany(ctx, params) {
			return this.adapter.removeMany(params.query)
				.then(doc => this.transformDocuments(ctx, doc))
				.then(json => this.clearCache().then(() => json));
		},

		/**
		 * Delete all entities
		 * 
		 * @returns {Promise}
		 */
		clear() {
			return this.adapter.clear()
				.then(count => this.clearCache().then(() => count));
		},

		/**
		 * Clear cache entities
		 * 
		 * @returns {Promise}
		 */
		clearCache() {
			this.broker.emit("cache.clean", this.name + ".*");
			return this.Promise.resolve();
		},

		/**
		 * Transform the fetched documents
		 * 
		 * @param {Array|Object} docs 
		 * @returns {Array|Object}
		 */
		transformDocuments(ctx, docs) {
			let isDoc = false;
			if (!Array.isArray(docs)) {
				if (_.isObject(docs)) {
					isDoc = true;
					docs = [docs];
				} else
					return this.Promise.resolve(docs);
			}

			return this.Promise.resolve(docs)

				// Convert entity to JS object
				.then(docs => docs.map(doc => this.adapter.entityToObject(doc)))

				// Encode IDs
				.then(docs => docs.map(doc => {
					doc[this.settings.idField] = this.encodeID(doc[this.settings.idField]);
					return doc;
				}))

				// Populate
				.then(json => (ctx && ctx.params.populate !== false) ? this.populateDocs(ctx, json) : json)

				// TODO onTransformDocumentsHook

				// Filter fields
				.then(json => {
					let fields = ctx && ctx.params.fields ? ctx.params.fields : this.settings.fields;

					// Compatibility with < 0.4
					/* istanbul ignore next */
					if (_.isString(fields))
						fields = fields.split(" ");

					return json.map(item => this.filterFields(item, fields));
				})

				// Return
				.then(json => isDoc ? json[0] : json);
		},

		/**
		 * Filter fields in the entity object
		 * 
		 * @param {Object} 	doc
		 * @param {Array} 	fields	Filter properties of model. It is a space-separated `String` or an `Array`
		 * @returns	{Object}
		 * 
		 * @memberOf Service
		 */
		filterFields(doc, fields) {
			// Apply field filter (support nested paths)
			if (Array.isArray(fields)) {
				let ff = this.authorizeFields(fields);
				let res = {};
				ff.forEach(n => {
					const v = _.get(doc, n);
					if (v !== undefined)
						_.set(res, n, v);
				});
				return res;
			}

			return doc;
		},

		/**
		 * Authorize the required field list. Remove fields which is not exist in `this.settings.fields`
		 * 
		 * @param {Array} fields 
		 * @returns {Array}
		 */
		authorizeFields(fields) {
			/*if (this.settings.fields && this.settings.fields.length > 0) {
				return _.intersection(fields, this.settings.fields);
			}*/

			return fields;
		},

		/**
		 * Populate documents
		 * 
		 * @param {Context} ctx				Context
		 * @param {Array} 	docs			Models
		 * @param {Object?}	populateRules	schema for population
		 * @returns	{Promise}
		 */
		populateDocs(ctx, docs, populateRules = this.settings.populates) {
			if (docs != null && populateRules && (_.isObject(docs) || Array.isArray(docs))) {
				let promises = [];
				_.forIn(populateRules, (rule, field) => {

					// if the rule is a function, save as a custom handler
					if (_.isFunction(rule)) {
						rule = {
							handler: this.Promise.method(rule)
						};
					}

					// If string, convert to object
					if (_.isString(rule)) {
						rule = {
							action: rule
						};
					}
					rule.field = field;

					// Collect IDs from field of docs (flatten, compact & unique list) 
					let idList = _.uniq(_.flattenDeep(_.compact(docs.map(doc => doc[field]))));
					if (idList.length > 0) {
						// Replace the received models according to IDs in the original docs
						const resultTransform = (populatedDocs) => {
							docs.forEach(doc => {
								let id = doc[field];
								if (_.isArray(id)) {
									let models = _.compact(id.map(id => populatedDocs[id]));
									doc[field] = models;
								} else {
									doc[field] = populatedDocs[id];
								}
							});
						};

						if (rule.handler) {
							promises.push(rule.handler.call(this, idList, rule, ctx).then(resultTransform));
						} else {
							// Call the target action & collect the promises
							const params = Object.assign({
								id: idList,
								resultAsObject: true,
								populate: !!rule.populate
							}, rule.params || []);

							promises.push(ctx.call(rule.action, params).then(resultTransform));
						}
					}
				});

				if (promises.length > 0) {
					return this.Promise.all(promises).then(() => docs);
				}
			}

			// Fallback, if no populate defined
			return this.Promise.resolve(docs);
		},

		/**
		 * Validate an entity by validator
		 * 
		 * @param {any} entity 
		 * @returns {Promise}
		 */
		validateEntity(entity) {
			if (!_.isFunction(this.settings.entityValidator))
				return this.Promise.resolve(entity);

			let entities = Array.isArray(entity) ? entity : [entity];
			return this.Promise.all(entities.map(entity => this.settings.entityValidator(entity))).then(() => entity);
		},

		/**
		 * Encode ID of entity
		 * 
		 * @param {any} id 
		 * @returns 
		 */
		encodeID(id) {
			return id;
		},

		/**
		 * Decode ID of entity
		 * 
		 * @param {any} id 
		 * @returns 
		 */
		decodeID(id) {
			return id;
		}
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {
		// Compatibility with < 0.4
		if (_.isString(this.settings.fields)) {
			this.settings.fields = this.settings.fields.split(" ");
		}		

		if (!this.schema.adapter)
			this.adapter = new MemoryAdapter();
		else
			this.adapter = this.schema.adapter;

		this.adapter.init(this.broker, this);

		// Transform entity validation schema to checker function
		if (this.broker.validator && _.isObject(this.settings.entityValidator)) {
			const check = this.broker.validator.compile(this.settings.entityValidator);
			this.settings.entityValidator = entity => {
				const res = check(entity);
				if (res === true)
					return this.Promise.resolve();
				else
					return this.Promise.reject(res);
			};
		}
		
	},

	/**
	 * Service started lifecycle event handler
	 */
	started() {
		if (this.adapter) {
			return new this.Promise(resolve => {
				let connecting = () => {
					this.connect().then(resolve).catch(err => {
						setTimeout(() => {
							this.logger.error("Connection error!", err);
							this.logger.warn("Reconnecting...");
							connecting();
						}, 1000);
					});
				};

				connecting();
			});
		}

		/* istanbul ignore next */
		return this.Promise.reject(new Error("Please set the store adapter in schema!"));
	},

	/**
	 * Service stopped lifecycle event handler
	 */
	stopped() {
		if (this.adapter)
			return this.disconnect();
	},

	// Export Memory Adapter class
	MemoryAdapter
};
