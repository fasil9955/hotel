import { useEffect, useState } from "react";
import {
  createCategory,
  createItem,
  createTable,
  deleteCategory,
  deleteItem,
  deleteTable,
  getCategories,
  getItems,
  getTables,
  updateItem,
  type Category,
  type DiningTable,
  type MenuItem,
} from "../api";
import { useSync } from "../live";
import { formatRupees } from "../money";

export function Menu() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [tableName, setTableName] = useState("");

  async function load() {
    const [nextCategories, nextItems, nextTables] = await Promise.all([getCategories(), getItems(), getTables()]);
    setCategories(nextCategories);
    setItems(nextItems);
    setTables(nextTables);
  }

  useEffect(() => {
    load().catch((caught: unknown) => setError(message(caught)));
  }, []);

  useSync((areas) => {
    if (!areas.has("menu")) return;
    load().catch((caught: unknown) => setError(message(caught)));
  });

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await load();
    } catch (caught) {
      setError(message(caught));
    }
  }

  return (
    <>
      {error ? <p className="banner bad">{error}</p> : null}
      <div className="split">
        <section>
          <div className="panel">
            <h1>Menu</h1>
            <form
              className="inline"
              onSubmit={(event) => {
                event.preventDefault();
                const name = categoryName;
                setCategoryName("");
                void run(() => createCategory(name));
              }}
            >
              <input
                value={categoryName}
                placeholder="Category, such as Mains"
                onChange={(event) => setCategoryName(event.target.value)}
              />
              <button type="submit" className="secondary">
                Add category
              </button>
            </form>
          </div>
          {categories.length === 0 ? (
            <section className="panel">
              <p className="lede">Add a category, then the dishes in it.</p>
            </section>
          ) : null}
          {categories.map((category) => (
            <CategoryBlock
              key={category.id}
              category={category}
              items={items.filter((item) => item.categoryId === category.id)}
              onChange={run}
            />
          ))}
        </section>
        <section className="panel">
          <h1>Tables</h1>
          <form
            className="inline"
            onSubmit={(event) => {
              event.preventDefault();
              const name = tableName;
              setTableName("");
              void run(() => createTable(name));
            }}
          >
            <input
              value={tableName}
              placeholder="Table name"
              onChange={(event) => setTableName(event.target.value)}
            />
            <button type="submit" className="secondary">
              Add
            </button>
          </form>
          <div className="table-grid">
            {tables.map((table) => (
              <div key={table.id} className="table-tile static">
                <strong>{table.name}</strong>
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    if (window.confirm(`Remove table ${table.name}?`)) void run(() => deleteTable(table.id));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {tables.length === 0 ? <p className="hint">Add the tables the waiters will tap.</p> : null}
        </section>
      </div>
    </>
  );
}

function CategoryBlock({
  category,
  items,
  onChange,
}: {
  category: Category;
  items: MenuItem[];
  onChange: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [parcelPrice, setParcelPrice] = useState("");
  const [veg, setVeg] = useState(true);

  return (
    <section className="panel">
      <div className="row-between">
        <h2>{category.name}</h2>
        <button
          type="button"
          className="text"
          onClick={() => {
            if (window.confirm(`Delete ${category.name}?`)) void onChange(() => deleteCategory(category.id));
          }}
        >
          Delete
        </button>
      </div>
      <ul className="menu-list">
        {items.map((item) => (
          <DishRow key={item.id} item={item} onChange={onChange} />
        ))}
      </ul>
      <form
        className="item-add"
        onSubmit={(event) => {
          event.preventDefault();
          const dish = name;
          const rupees = price;
          const parcel = parcelPrice;
          const isVeg = veg;
          setName("");
          setPrice("");
          setParcelPrice("");
          void onChange(() =>
            createItem({
              categoryId: category.id,
              name: dish,
              priceRupees: rupees,
              parcelPriceRupees: parcel || rupees,
              veg: isVeg,
            }),
          );
        }}
      >
        <input value={name} placeholder="Dish" onChange={(event) => setName(event.target.value)} />
        <input
          value={price}
          inputMode="decimal"
          placeholder="Table price"
          onChange={(event) => setPrice(event.target.value)}
        />
        <input
          value={parcelPrice}
          inputMode="decimal"
          placeholder="Parcel price"
          onChange={(event) => setParcelPrice(event.target.value)}
        />
        <button type="button" className="secondary" aria-pressed={veg} onClick={() => setVeg((value) => !value)}>
          {veg ? "Veg" : "Non-veg"}
        </button>
        <button type="submit" className="primary">
          Add dish
        </button>
      </form>
    </section>
  );
}

function DishRow({
  item,
  onChange,
}: {
  item: MenuItem;
  onChange: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [tablePrice, setTablePrice] = useState(rupeeInput(item.pricePaise));
  const [parcelPrice, setParcelPrice] = useState(rupeeInput(item.parcelPricePaise));

  useEffect(() => {
    setTablePrice(rupeeInput(item.pricePaise));
    setParcelPrice(rupeeInput(item.parcelPricePaise));
  }, [item.pricePaise, item.parcelPricePaise]);

  return (
    <li>
      <div>
        <strong>{item.name}</strong>
        <span className={item.veg ? "veg" : "nonveg"}>{item.veg ? "Veg" : "Non-veg"}</span>
        <span>Table {formatRupees(item.pricePaise)}</span>
        <span>Parcel {formatRupees(item.parcelPricePaise)}</span>
      </div>
      <form
        className="item-add"
        onSubmit={(event) => {
          event.preventDefault();
          void onChange(() => updateItem(item.id, { priceRupees: tablePrice, parcelPriceRupees: parcelPrice }));
        }}
      >
        <input
          value={tablePrice}
          inputMode="decimal"
          aria-label={`${item.name} table price`}
          onChange={(event) => setTablePrice(event.target.value)}
        />
        <input
          value={parcelPrice}
          inputMode="decimal"
          aria-label={`${item.name} parcel price`}
          onChange={(event) => setParcelPrice(event.target.value)}
        />
        <button type="submit" className="secondary">
          Save prices
        </button>
        <button type="button" className="text" onClick={() => void onChange(() => updateItem(item.id, { available: !item.available }))}>
          {item.available ? "On menu" : "Hidden"}
        </button>
        <button
          type="button"
          className="text"
          onClick={() => {
            if (window.confirm(`Delete ${item.name}?`)) void onChange(() => deleteItem(item.id));
          }}
        >
          Delete
        </button>
      </form>
    </li>
  );
}

function rupeeInput(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
