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
import { useConfirm } from "../confirm";
import { useSync } from "../live";
import { formatRupees } from "../money";

export function Menu() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [tableName, setTableName] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  async function load(selectId?: number) {
    const [nextCategories, nextItems, nextTables] = await Promise.all([getCategories(), getItems(), getTables()]);
    setCategories(nextCategories);
    setItems(nextItems);
    setTables(nextTables);
    setSelectedId((current) => {
      if (selectId !== undefined && nextCategories.some((category) => category.id === selectId)) return selectId;
      if (current !== null && nextCategories.some((category) => category.id === current)) return current;
      return nextCategories[0]?.id ?? null;
    });
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
      const result = await action();
      await load(typeof result === "number" ? result : undefined);
    } catch (caught) {
      setError(message(caught));
    }
  }

  const selected = categories.find((category) => category.id === selectedId) ?? null;

  return (
    <>
      {dialog}
      {error ? <p className="banner bad">{error}</p> : null}
      <div className="menu-page">
        <aside className="panel menu-side">
          <h1>Categories</h1>
          {categories.length === 0 ? <p className="lede">Add a category, then the dishes in it.</p> : null}
          <ul className="menu-cats">
            {categories.map((category) => {
              const count = items.filter((item) => item.categoryId === category.id).length;
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    aria-pressed={category.id === selectedId}
                    onClick={() => setSelectedId(category.id)}
                  >
                    {category.name}
                    <span>{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            className="inline"
            onSubmit={(event) => {
              event.preventDefault();
              const name = categoryName;
              setCategoryName("");
              void run(async () => {
                const created = await createCategory(name);
                return created.id;
              });
            }}
          >
            <input
              value={categoryName}
              placeholder="New category"
              aria-label="New category"
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <button type="submit" className="secondary">
              Add category
            </button>
          </form>
        </aside>
        <div>
          {selected ? (
            <CategoryBlock
              key={selected.id}
              category={selected}
              items={items.filter((item) => item.categoryId === selected.id)}
              onChange={run}
              confirm={confirm}
            />
          ) : (
            <section className="panel">
              <h1>Dishes</h1>
              <p className="lede">Add a category, then the dishes in it.</p>
            </section>
          )}
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
                  onClick={() => confirm(`Remove table ${table.name}?`, () => void run(() => deleteTable(table.id)))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {tables.length === 0 ? <p className="hint">Add the tables the waiters will tap.</p> : null}
        </section>
        </div>
      </div>
    </>
  );
}

function CategoryBlock({
  category,
  items,
  onChange,
  confirm,
}: {
  category: Category;
  items: MenuItem[];
  onChange: (action: () => Promise<unknown>) => Promise<void>;
  confirm: (message: string, onYes: () => void) => void;
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
          onClick={() => confirm(`Delete ${category.name}?`, () => void onChange(() => deleteCategory(category.id)), )}
        >
          Delete
        </button>
      </div>
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
      {items.length === 0 ? <p className="hint">No dishes in this category yet.</p> : null}
      <ul className="menu-list">
        {items.map((item) => (
          <DishRow key={item.id} item={item} onChange={onChange} confirm={confirm} />
        ))}
      </ul>
    </section>
  );
}

function DishRow({
  item,
  onChange,
  confirm,
}: {
  item: MenuItem;
  onChange: (action: () => Promise<unknown>) => Promise<void>;
  confirm: (message: string, onYes: () => void) => void;
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
          onClick={() => confirm(`Delete ${item.name}?`, () => void onChange(() => deleteItem(item.id)))}
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
